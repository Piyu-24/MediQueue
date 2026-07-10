const express = require('express');
const { body, query: queryValidator, validationResult } = require('express-validator');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const TimeBlock = require('../models/TimeBlock');
const Department = require('../models/Department');
const QueuePolicy = require('../models/QueuePolicy');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { getSlotAvailability, getAvailableDoctors, checkBookingEligibility, ACTIVE_BOOKING_STATUSES } = require('../services/AvailabilityService');
const { getAvailableBlocks, isSessionClosed, isBookingCutoffReached } = require('../services/TimeBlockService');
const { nextAppointmentToken, buildScope } = require('../services/TokenSequenceService');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/appointments/doctors/available
// Return available doctors for a department/date with slot summaries.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/doctors/available',
  [
    queryValidator('date').isISO8601().withMessage('Valid date is required (YYYY-MM-DD)'),
    queryValidator('departmentId').optional().isString()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { date, departmentId } = req.query;
      // patientId optional — used to surface PATIENT_CONFLICT
      const patientId = req.query.patientId || null;

      const doctors = await getAvailableDoctors(departmentId || null, date, patientId);

      res.json({
        success: true,
        count: doctors.length,
        data: { doctors, date }
      });
    } catch (error) {
      console.error('Available doctors error:', error);
      res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/appointments/availability
//
// Dual-mode endpoint:
//
//  Mode A — Block-based (General OPD):
//   ?departmentId=<id>&date=YYYY-MM-DD[&blockBased=true][&doctorId=<id>]
//   Returns TimeBlock records for the department with slot availability status.
//
//  Mode B — Exact-slot (Specialist, legacy):
//   ?doctorId=<id>&date=YYYY-MM-DD[&patientId=<id>]
//   Returns per-slot availability grid (existing AvailabilityService behaviour).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/availability',
  [
    queryValidator('date').isISO8601().withMessage('Valid date is required (YYYY-MM-DD)'),
    queryValidator('doctorId').optional().isMongoId().withMessage('Invalid doctorId'),
    queryValidator('departmentId').optional().isMongoId().withMessage('Invalid departmentId'),
    queryValidator('patientId').optional().isMongoId()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { doctorId, departmentId, date, patientId, blockBased } = req.query;

      // ── Mode A: block-based ────────────────────────────────────────────────
      if (departmentId || blockBased === 'true') {
        if (!departmentId) {
          return res.status(400).json({ success: false, message: 'departmentId is required for block-based availability' });
        }

        const blocks = await getAvailableBlocks(departmentId, date, doctorId || null, patientId || null);
        return res.json({
          success: true,
          mode: 'block',
          date,
          departmentId,
          data: blocks
        });
      }

      // ── Mode B: exact-slot (legacy, specialist) ────────────────────────────
      if (!doctorId) {
        return res.status(400).json({
          success: false,
          message: 'Either departmentId (block-based) or doctorId (slot-based) is required'
        });
      }

      const result = await getSlotAvailability(doctorId, date, patientId || null);
      return res.json({ success: true, mode: 'slot', data: result });
    } catch (error) {
      console.error('Availability error:', error);
      res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
    }
  }
);

// @desc    Get appointments
// @route   GET /api/appointments
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    let query = {};
    
    // Additional filters
    const { status, date, doctorId, patientId } = req.query;
    
    console.log('Get appointments - User:', req.user.role, 'Query params:', { status, date, doctorId, patientId });
    
    // Filter based on user role
    if (req.user.role === 'patient') {
      // If patient is checking availability (doctorId + date provided), show all appointments for that doctor
      // This allows patients to see which slots are already booked
      if (doctorId && date) {
        query.doctor = doctorId;
        const startDate = new Date(date);
        const endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
        query.appointmentDate = { $gte: startDate, $lt: endDate };
        // Only show booked slots (scheduled, confirmed)
        if (status) {
          const statusArray = status.split(',');
          query.status = { $in: statusArray };
        }
      } else {
        // Otherwise, only show patient's own appointments
        query.patient = req.user.id;
      }
    } else if (req.user.role === 'doctor') {
      query.doctor = req.user.id;
    } else {
      // Staff, Manager, Admin can query any appointments
      if (doctorId) {
        query.doctor = doctorId;
      }
      if (patientId) {
        query.patient = patientId;
      }
    }
    
    // Apply status filter if not already set
    if (status && !query.status) {
      const statusArray = status.split(',');
      query.status = { $in: statusArray };
    }
    
    // Apply date filter if not already set
    if (date && !query.appointmentDate) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      query.appointmentDate = { $gte: startDate, $lt: endDate };
    }

    const appointments = await Appointment.find(query)
      .populate('patient', 'firstName lastName email phone digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization department')
      .populate('timeBlockId', 'startTime endTime')
      .sort({ appointmentDate: 1, appointmentTime: 1 });

    console.log('Query built:', JSON.stringify(query));
    console.log('Found appointments:', appointments.length);

    res.json({
      success: true,
      count: appointments.length,
      data: { appointments }
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Look up appointment by reference number, patient name, or phone (reception use)
// @route   GET /api/appointments/lookup
// @access  Private (receptionist, staff, admin)
router.get('/lookup', auth, authorize('receptionist', 'staff', 'admin'), async (req, res) => {
  try {
    const { reference, name, phone, date } = req.query;

    if (!reference && !name && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one search parameter: reference, name, or phone'
      });
    }

    let query = {};

    if (reference) {
      query.appointmentReference = reference.trim().toUpperCase();
    }

    // Date scoping — defaults to today if not provided (local date, not UTC)
    const _now = new Date();
    const localToday = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
    const searchDate = date || localToday;
    const startOfDay = new Date(searchDate);
    const endOfDay = new Date(searchDate);
    endOfDay.setDate(endOfDay.getDate() + 1);
    if (!reference) {
      query.appointmentDate = { $gte: startOfDay, $lt: endOfDay };
    }

    query.status = { $in: ['booked', 'scheduled', 'confirmed', 'checked_in', 'in_queue'] };

    let appointments = await Appointment.find(query)
      .populate('patient', 'firstName lastName phone email digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization department')
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .limit(20);

    // Filter by patient name or phone on populated fields
    if (name) {
      const nameLower = name.toLowerCase();
      appointments = appointments.filter(a =>
        a.patient &&
        (`${a.patient.firstName} ${a.patient.lastName}`).toLowerCase().includes(nameLower)
      );
    }
    if (phone) {
      appointments = appointments.filter(a =>
        a.patient && a.patient.phone && a.patient.phone.includes(phone.trim())
      );
    }

    res.json({
      success: true,
      count: appointments.length,
      data: { appointments }
    });
  } catch (error) {
    console.error('Appointment lookup error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Get patient's doctor-unavailable appointments (pending reschedule)
// @route   GET /api/appointments/pending-reschedule
// @access  Private (Patient)
router.get('/pending-reschedule', auth, authorize('patient'), async (req, res) => {
  try {
    const appointments = await Appointment.find({
      patient: req.user.id,
      status: 'doctor-unavailable'
    })
      .populate('doctor', 'firstName lastName specialization department')
      .sort({ appointmentDate: 1, appointmentTime: 1 });

    res.json({
      success: true,
      count: appointments.length,
      data: { appointments }
    });
  } catch (error) {
    console.error('Get pending reschedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create appointment
// @route   POST /api/appointments
// @access  Private (Patient, Receptionist, Staff, Admin)
//
// Supports two booking modes determined by the `bookingType` field:
//
//  ── Mode A: General OPD (bookingType = 'general_opd') ──────────────────────
//   Required: departmentId, timeBlockId, appointmentDate, chiefComplaint, appointmentType
//   Optional: symptoms, notes.patient
//   Result  : A token issued immediately at booking. Doctor assigned at check-in.
//
//  ── Mode B: Specialist (bookingType = 'specialist' or legacy default) ───────
//   Required: doctor, appointmentDate, appointmentTime, chiefComplaint, appointmentType
//   Optional: timeBlockId (if specialist also uses blocks), symptoms
//   Result  : Legacy exact-time booking preserved; A token issued if timeBlockId given.
router.post('/', auth, authorize('patient', 'receptionist', 'staff', 'admin'), [
  body('appointmentDate').isISO8601().withMessage('Please select a valid appointment date.'),
  body('appointmentType')
    .isIn(['consultation', 'follow-up', 'check-up', 'emergency', 'routine'])
    .withMessage('Invalid appointment type'),
  body('chiefComplaint')
    .isLength({ min: 5, max: 500 })
    .withMessage('Chief complaint must be between 5-500 characters'),
  // Mode A fields
  body('departmentId').optional().isMongoId().withMessage('Invalid departmentId'),
  body('timeBlockId').optional().isMongoId().withMessage('Invalid timeBlockId'),
  body('bookingType').optional().isIn(['general_opd', 'specialist']),
  // Mode B (legacy) fields
  body('doctor').optional().isMongoId().withMessage('Invalid doctor ID'),
  body('appointmentTime')
    .optional()
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Valid time format required (HH:MM)'),
  // Security: validate IDs supplied by the client to prevent forged requests
  body('patientId').optional().isMongoId().withMessage('Invalid patientId'),
  body('rescheduledFromAppointmentId').optional().isMongoId().withMessage('Invalid rescheduledFromAppointmentId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const {
      bookingType = 'specialist',
      departmentId,
      timeBlockId,
      doctor,
      appointmentDate,
      appointmentTime,
      duration = 30,
      appointmentType,
      chiefComplaint,
      symptoms,
      rescheduledFromAppointmentId
    } = req.body;

    // The actual patient: for staff/admin/receptionist booking on behalf of a patient,
    // allow `patientId` in the body; otherwise default to the logged-in user.
    const patientId = (
      ['receptionist', 'staff', 'admin'].includes(req.user.role) && req.body.patientId
    ) ? req.body.patientId : req.user.id;

    // Security: verify the patientId actually refers to an active patient account.
    // This prevents staff from booking against fabricated or non-patient IDs.
    if (['receptionist', 'staff', 'admin'].includes(req.user.role) && req.body.patientId) {
      const patientUser = await User.findOne({ _id: patientId, role: 'patient', isActive: true });
      if (!patientUser) {
        return res.status(404).json({ success: false, message: 'Patient not found or account inactive.' });
      }
    }

    // ── MODE A: General OPD ──────────────────────────────────────────────────
    if (bookingType === 'general_opd') {
      if (!departmentId || !timeBlockId) {
        return res.status(400).json({
          success: false,
          message: 'General OPD bookings require departmentId and timeBlockId'
        });
      }

      // Verify department is active
      const dept = await Department.findOne({ _id: departmentId, status: 'active' });
      if (!dept) {
        return res.status(404).json({ success: false, message: 'Department not found or inactive.' });
      }

      // Prevent past-date booking
      const apptDate = new Date(appointmentDate);
      apptDate.setHours(23, 59, 59, 999);
      if (apptDate <= new Date()) {
        return res.status(400).json({ success: false, message: 'Appointments cannot be booked for past dates.' });
      }

      // Security: verify the time block belongs to the stated department and date.
      // Prevents a patient from using a block from a different department or day.
      const dateStr = new Date(appointmentDate).toISOString().slice(0, 10);
      const blockOwnership = await TimeBlock.findOne({ _id: timeBlockId, departmentId, date: dateStr });
      if (!blockOwnership) {
        return res.status(400).json({
          success: false,
          message: 'The selected session does not match this department and date. Please select a valid appointment date.'
        });
      }

      // Validate block status — reject closed, cancelled, or manually disabled blocks
      if (!['active'].includes(blockOwnership.status)) {
        return res.status(409).json({
          success: false,
          message: `This appointment slot is ${blockOwnership.status}. Please choose another session.`
        });
      }

      // Time-of-day guard: booking closes `minimumArrivalBufferMinutes` before the session
      // end time, giving the patient enough time to arrive and check in.
      // Example: slot 16:00-18:00 with 30-min buffer → cutoff 17:30.
      // Booking at 16:33 is allowed; booking at 17:30 or later is rejected.
      if (isBookingCutoffReached(dateStr, blockOwnership.endTime, 30)) {
        return res.status(409).json({
          success: false,
          message: 'Booking for this session has closed because there is not enough time to arrive before the doctor session ends. Please choose a later session or a different date.'
        });
      }

      // Duplicate booking guard: prevent the same patient from booking the same session twice.
      // This runs before slot deduction so we don't waste an atomic counter.
      const isOPDDuplicate = await Appointment.hasOPDDuplicate(patientId, timeBlockId);
      if (isOPDDuplicate) {
        return res.status(409).json({
          success: false,
          message: 'You already have an appointment booked for this session. Please choose a different date or session.'
        });
      }

      // ── Booking Conflict Rule 1: Same department, same day ─────────────────
      // Block if the patient already has any active appointment for this department today.
      const sameDeptConflict = await Appointment.hasActiveSameDeptDayConflict(
        patientId, departmentId, appointmentDate
      );
      if (sameDeptConflict) {
        return res.status(409).json({
          success: false,
          message: 'You already have an active appointment for this department on this date. Please cancel or reschedule the existing appointment before booking another.'
        });
      }

      // ── Booking Conflict Rule 2: Different department, time overlap ─────────
      // Block if the new time block overlaps with any active appointment in another department.
      const timeOverlapConflict = await Appointment.hasActiveTimeBlockOverlap(
        patientId, departmentId, appointmentDate, blockOwnership.startTime, blockOwnership.endTime
      );
      if (timeOverlapConflict) {
        return res.status(409).json({
          success: false,
          message: 'You already have another appointment during this time. Please choose a non-conflicting time slot.'
        });
      }

      // Atomically deduct one appointment slot from the time block
      const block = await TimeBlock.deductAppointmentSlot(timeBlockId);
      if (!block) {
        return res.status(409).json({
          success: false,
          message: 'This time block is full or no longer available for booking.'
        });
      }

      // Resolve token scope from policy
      const policy = await QueuePolicy.resolveFor(null, departmentId);
      const scope = buildScope({
        departmentId,
        doctorId: null,
        date: new Date(appointmentDate).toISOString().slice(0, 10),
        timeBlockId,
        tokenScope: policy.tokenScope || 'dept_date_session'
      });

      // Generate A token — atomic, no retry needed
      let tokenResult;
      try {
        tokenResult = await nextAppointmentToken(scope);
      } catch (tokenErr) {
        // Roll back the slot deduction before throwing
        await TimeBlock.releaseAppointmentSlot(timeBlockId);
        throw tokenErr;
      }

      // Create appointment with token and block reference
      let appointment;
      try {
        appointment = await Appointment.create({
          patient:            patientId,
          doctor:             null,
          appointmentDate,
          appointmentTime:    block.startTime, // use block start as reference time
          departmentId,
          timeBlockId,
          bookingType:        'general_opd',
          appointmentType,
          chiefComplaint,
          symptoms:           symptoms || [],
          status:             'booked',
          appointmentToken:   tokenResult.queueNumber,
          tokenNumber:        tokenResult.sequenceNumber,
          tokenPrefix:        'A',
          reportingTime:      block.reportingTime,
          department:         dept.name,
          rescheduledFromAppointmentId: rescheduledFromAppointmentId || null
        });
      } catch (createErr) {
        // Roll back slot on DB error
        await TimeBlock.releaseAppointmentSlot(timeBlockId);
        if (createErr.code === 11000) {
          return res.status(409).json({
            success: false,
            message: 'This appointment slot has already been booked. Please choose another session.'
          });
        }
        throw createErr;
      }

      // Handle reschedule source
      if (rescheduledFromAppointmentId) {
        await Appointment.findOneAndUpdate(
          { _id: rescheduledFromAppointmentId, patient: patientId, status: 'doctor-unavailable' },
          { status: 'rescheduled' }
        );
      }

      await appointment.populate([
        { path: 'patient', select: 'firstName lastName email phone' },
        { path: 'departmentId', select: 'name code' },
        { path: 'timeBlockId', select: 'startTime endTime sessionName reportingTime' }
      ]);

      // Booking confirmation notification — General OPD
      try {
        const apptDateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        await Notification.create({
          recipient: patientId,
          type: 'appointment-reminder',
          title: 'Appointment Booked – Confirmation',
          message: `Your ${appointmentType} appointment at ${dept.name} is confirmed for ${apptDateStr} (${block.sessionName || block.startTime + '–' + block.endTime}). Your token is ${appointment.appointmentToken}. Please arrive by ${appointment.reportingTime}.`,
          metadata: { appointmentId: appointment._id, appointmentDate: appointmentDate, department: dept.name }
        });
      } catch (notifErr) {
        console.error('Notification create failed (non-fatal):', notifErr.message);
      }

      return res.status(201).json({
        success: true,
        message: `Your appointment is confirmed. Your token is ${appointment.appointmentToken}. Please arrive by ${appointment.reportingTime}.`,
        data: {
          appointment,
          token: {
            number:        appointment.appointmentToken,
            prefix:        'A',
            sequenceNumber: appointment.tokenNumber,
            reportingTime: appointment.reportingTime,
            timeBlock: {
              startTime:   block.startTime,
              endTime:     block.endTime,
              sessionName: block.sessionName,
              date:        block.date
            },
            patientMessage: `Your appointment token is ${appointment.appointmentToken}. You are booked for the ${block.sessionName || block.startTime + ' – ' + block.endTime} session on ${block.date}. Please arrive by ${appointment.reportingTime}. Your token will be activated after check-in at reception.`
          }
        }
      });
    }

    // ── MODE B: Specialist / Legacy exact-time ───────────────────────────────
    if (!doctor) {
      return res.status(400).json({
        success: false,
        message: 'Specialist bookings require a doctor ID'
      });
    }
    if (!appointmentTime) {
      return res.status(400).json({
        success: false,
        message: 'Specialist bookings require an appointmentTime (HH:MM)'
      });
    }

    // Verify doctor exists and is active
    const doctorUser = await User.findOne({ _id: doctor, role: 'doctor', isActive: true });
    if (!doctorUser) {
      return res.status(404).json({ success: false, message: 'The selected doctor is unavailable. Please choose another doctor.' });
    }

    // Security: if a departmentId was provided, verify the doctor actually belongs to it.
    // Prevents crafted requests that pair a real doctor with an unrelated department.
    if (departmentId) {
      const dept = await Department.findOne({ _id: departmentId, status: 'active' });
      if (!dept) {
        return res.status(404).json({ success: false, message: 'The selected department was not found or is inactive.' });
      }
      const doctorDept = (doctorUser.department || '').toLowerCase();
      if (doctorDept !== dept.name.toLowerCase() && doctorDept !== (dept.code || '').toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: 'The selected doctor does not belong to the selected department. Please select a valid department-doctor combination.'
        });
      }
    }

    // Prevent booking in the past
    const [h, m] = appointmentTime.split(':').map(Number);
    const slotDateTime = new Date(appointmentDate);
    slotDateTime.setHours(h, m, 0, 0);
    if (slotDateTime <= new Date()) {
      return res.status(400).json({ success: false, message: 'Appointments cannot be booked for past dates.' });
    }

    // Check doctor availability: working schedule, DoctorSlot blocks, slot capacity
    const dateStr = new Date(appointmentDate).toISOString().split('T')[0];
    const eligibility = await checkBookingEligibility(doctor, dateStr, appointmentTime, duration);
    if (!eligibility.available) {
      const statusCode = eligibility.reason?.includes('fully booked') ? 409 : 400;
      return res.status(statusCode).json({ success: false, message: eligibility.reason });
    }

    // Doctor-side time overlap (slot no longer available — race condition safety net)
    const doctorConflict = await Appointment.hasConflict(doctor, appointmentDate, appointmentTime, duration);
    if (doctorConflict) {
      return res.status(409).json({
        success: false,
        message: 'The selected slot is no longer available. Please choose another slot.'
      });
    }

    // Patient-side conflict: patient already has an overlapping appointment elsewhere
    const patientConflict = await Appointment.hasPatientConflict(patientId, appointmentDate, appointmentTime, duration);
    if (patientConflict) {
      return res.status(409).json({
        success: false,
        message: 'You already have an appointment for this doctor at the selected time. Please select a different slot.'
      });
    }

    // Validate reschedule source
    if (rescheduledFromAppointmentId) {
      const sourceAppt = await Appointment.findOne({ _id: rescheduledFromAppointmentId, patient: patientId });
      if (!sourceAppt) {
        return res.status(404).json({ success: false, message: 'Source appointment not found for reschedule.' });
      }
    }

    // If specialist booking also uses a time block, validate it then deduct its slot
    let specialistToken = null;
    let specialistBlock = null;
    if (timeBlockId) {
      // Security: verify the block belongs to this doctor and date
      const specBlockOwnership = await TimeBlock.findOne({ _id: timeBlockId, date: dateStr });
      if (!specBlockOwnership) {
        return res.status(400).json({
          success: false,
          message: 'The selected session does not match the appointment date. Please select a valid appointment date.'
        });
      }
      if (specBlockOwnership.status !== 'active') {
        return res.status(409).json({
          success: false,
          message: `Booking failed because the schedule changed while you were booking. The session is now ${specBlockOwnership.status}. Please choose another session.`
        });
      }
      // Prevent duplicate booking into the same block
      const isBlockDuplicate = await Appointment.hasOPDDuplicate(patientId, timeBlockId);
      if (isBlockDuplicate) {
        return res.status(409).json({
          success: false,
          message: 'You already have an appointment booked for this session. Please choose a different session.'
        });
      }

      // ── Booking Conflict Rule 1: Same department, same day ─────────────────
      if (departmentId) {
        const specSameDeptConflict = await Appointment.hasActiveSameDeptDayConflict(
          patientId, departmentId, appointmentDate
        );
        if (specSameDeptConflict) {
          return res.status(409).json({
            success: false,
            message: 'You already have an active appointment for this department on this date. Please cancel or reschedule the existing appointment before booking another.'
          });
        }
      }

      // ── Booking Conflict Rule 2: Different department, time overlap ─────────
      if (departmentId) {
        const specTimeOverlap = await Appointment.hasActiveTimeBlockOverlap(
          patientId, departmentId, appointmentDate,
          specBlockOwnership.startTime, specBlockOwnership.endTime
        );
        if (specTimeOverlap) {
          return res.status(409).json({
            success: false,
            message: 'You already have another appointment during this time. Please choose a non-conflicting time slot.'
          });
        }
      }

      specialistBlock = await TimeBlock.deductAppointmentSlot(timeBlockId);
      if (!specialistBlock) {
        return res.status(409).json({
          success: false,
          message: 'This appointment slot has already been booked. Please choose another session.'
        });
      }
      const policy = await QueuePolicy.resolveFor(doctor, doctorUser.department);
      const scope = buildScope({
        departmentId: null,
        doctorId: doctor,
        date: dateStr,
        timeBlockId,
        tokenScope: policy.tokenScope || 'doctor_date'
      });
      try {
        specialistToken = await nextAppointmentToken(scope);
      } catch (tokenErr) {
        await TimeBlock.releaseAppointmentSlot(timeBlockId);
        throw tokenErr;
      }
    }

    // Create appointment
    let appointment;
    try {
      appointment = await Appointment.create({
        patient:            patientId,
        doctor,
        appointmentDate,
        appointmentTime,
        duration,
        bookingType:        'specialist',
        departmentId:       departmentId || null,
        timeBlockId:        timeBlockId  || null,
        appointmentType,
        chiefComplaint,
        symptoms:           symptoms || [],
        status:             specialistToken ? 'booked' : 'scheduled',
        appointmentToken:   specialistToken?.queueNumber || null,
        tokenNumber:        specialistToken?.sequenceNumber || null,
        tokenPrefix:        specialistToken ? 'A' : null,
        reportingTime:      specialistBlock?.reportingTime || null,
        department:         doctorUser.department,
        rescheduledFromAppointmentId: rescheduledFromAppointmentId || null
      });
    } catch (createErr) {
      if (timeBlockId && specialistBlock) await TimeBlock.releaseAppointmentSlot(timeBlockId);
      if (createErr.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'This appointment slot has already been booked. Please choose another slot.'
        });
      }
      throw createErr;
    }

    // Handle reschedule source
    if (rescheduledFromAppointmentId) {
      await Appointment.findOneAndUpdate(
        { _id: rescheduledFromAppointmentId, patient: patientId, status: 'doctor-unavailable' },
        { status: 'rescheduled' }
      );
    }

    await appointment.populate([
      { path: 'patient', select: 'firstName lastName email phone' },
      { path: 'doctor', select: 'firstName lastName specialization department' }
    ]);

    // Booking confirmation notification — Specialist
    try {
      const apptDateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const doctorName = `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`;
      const tokenInfo = specialistToken ? ` Your token is ${appointment.appointmentToken}.` : '';
      await Notification.create({
        recipient: patientId,
        type: 'appointment-reminder',
        title: 'Appointment Booked – Confirmation',
        message: `Your ${appointmentType} appointment with ${doctorName} is confirmed for ${apptDateStr} at ${appointmentTime}.${tokenInfo} Ref: ${appointment.appointmentReference}.`,
        metadata: { appointmentId: appointment._id, appointmentDate: appointmentDate, appointmentTime: appointmentTime, doctorName }
      });
    } catch (notifErr) {
      console.error('Notification create failed (non-fatal):', notifErr.message);
    }

    const tokenMsg = specialistToken
      ? ` Your appointment token is ${appointment.appointmentToken}. Please arrive by ${appointment.reportingTime}.`
      : ' Your live queue token will be issued after check-in at the hospital.';

    return res.status(201).json({
      success: true,
      message: `Appointment booked successfully. Reference: ${appointment.appointmentReference}.${tokenMsg}`,
      data: {
        appointment,
        ...(specialistToken && {
          token: {
            number:         appointment.appointmentToken,
            prefix:         'A',
            sequenceNumber: appointment.tokenNumber,
            reportingTime:  appointment.reportingTime,
            patientMessage: `Your appointment token is ${appointment.appointmentToken}. Please arrive by ${appointment.reportingTime}. Your token will be activated after check-in at reception.`
          }
        })
      }
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Return dates (YYYY-MM-DD) within a window where the patient already has
//          an active booking for a specific department. Used by the frontend to
//          highlight/block those dates on the OPD calendar before session selection.
// @route   GET /api/appointments/booked-dates
// @access  Private (Patient, Receptionist, Staff, Admin)
router.get('/booked-dates',
  auth,
  authorize('patient', 'receptionist', 'staff', 'admin'),
  [
    queryValidator('departmentId').isMongoId().withMessage('Valid departmentId is required'),
    queryValidator('from').optional().isISO8601(),
    queryValidator('to').optional().isISO8601(),
    queryValidator('patientId').optional().isMongoId()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { departmentId } = req.query;

      // Staff can query on behalf of a patient; patients only see their own data
      const patientId = (
        ['receptionist', 'staff', 'admin'].includes(req.user.role) && req.query.patientId
      ) ? req.query.patientId : req.user.id;

      // Default window: today → 3 months ahead (mirrors the booking UI range)
      const fromDate = req.query.from ? new Date(req.query.from) : new Date();
      fromDate.setHours(0, 0, 0, 0);
      const toDate = req.query.to ? new Date(req.query.to) : (() => {
        const d = new Date(); d.setMonth(d.getMonth() + 3); return d;
      })();
      toDate.setHours(23, 59, 59, 999);

      const appointments = await Appointment.find({
        patient: patientId,
        departmentId,
        appointmentDate: { $gte: fromDate, $lte: toDate },
        status: { $in: ACTIVE_BOOKING_STATUSES }
      }).select('appointmentDate appointmentToken timeBlockId').lean();

      // Deduplicate to one entry per calendar date
      const seen = new Set();
      const dates = [];
      for (const a of appointments) {
        const d = new Date(a.appointmentDate).toISOString().slice(0, 10);
        if (!seen.has(d)) {
          seen.add(d);
          dates.push({ date: d, token: a.appointmentToken || null });
        }
      }

      return res.json({ success: true, data: { dates, departmentId } });
    } catch (error) {
      console.error('Booked dates error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// @desc    Get appointment by ID
// @route   GET /api/appointments/:id
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('patient', 'firstName lastName email phone digitalHealthCardId bloodType allergies')
      .populate('doctor', 'firstName lastName specialization department');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check authorization — doctor may be null for General OPD appointments
    const isAuthorized =
      appointment.patient._id.toString() === req.user.id ||
      (appointment.doctor && appointment.doctor._id.toString() === req.user.id) ||
      ['staff', 'admin', 'receptionist'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this appointment'
      });
    }

    res.json({
      success: true,
      data: { appointment }
    });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Check doctor availability
// @route   GET /api/appointments/availability/:doctorId
// @access  Public
router.get('/availability/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date parameter is required'
      });
    }

    const bookedSlots = await Appointment.findAvailableSlots(doctorId, date);

    res.json({
      success: true,
      data: { 
        date,
        bookedSlots: bookedSlots.map(apt => ({
          time: apt.appointmentTime,
          duration: apt.duration
        }))
      }
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Statuses that mean the appointment slot is already in active hospital workflow —
// date/time changes are blocked once the patient has passed these gates.
// 'booked' is included: a token has already been issued and a block slot consumed;
// the patient must cancel and rebook (which releases the block slot properly).
const NON_RESCHEDULABLE_STATUSES = [
  'booked', 'checked_in', 'in_queue', 'in_consultation', 'in-progress',
  'completed', 'cancelled', 'no-show', 'rescheduled', 'doctor-unavailable'
];

// @desc    Update appointment
// @route   PUT /api/appointments/:id
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    let appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    // Check authorization — doctor may be null for General OPD appointments
    const canEdit =
      appointment.patient.toString() === req.user.id ||
      (appointment.doctor && appointment.doctor.toString() === req.user.id) ||
      ['receptionist', 'staff', 'admin'].includes(req.user.role);

    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this appointment' });
    }

    // Allowed fields for update based on role
    const allowedUpdates = {
      patient:       ['appointmentDate', 'appointmentTime', 'chiefComplaint', 'symptoms', 'notes.patient'],
      doctor:        ['status', 'notes.doctor', 'prescription', 'vitalSigns', 'diagnosis', 'labTests', 'referrals', 'followUp'],
      receptionist:  ['status', 'checkIn', 'room', 'notes.staff'],
      staff:         ['status', 'checkIn', 'room', 'notes.staff'],
      admin:         ['status', 'room', 'department', 'appointmentDate', 'appointmentTime']
    };

    const userAllowedUpdates = allowedUpdates[req.user.role] || [];

    // Rescheduling — only allowed when appointment is still schedulable
    if (req.body.appointmentDate || req.body.appointmentTime) {
      // Non-admin roles cannot reschedule past the check-in gate
      if (req.user.role !== 'admin' && NON_RESCHEDULABLE_STATUSES.includes(appointment.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot reschedule an appointment with status '${appointment.status}'.`
        });
      }

      const newDate = req.body.appointmentDate || appointment.appointmentDate;
      const newTime = req.body.appointmentTime || appointment.appointmentTime;
      const dur     = appointment.duration;

      // Prevent rescheduling to the past
      const [rh, rm] = newTime.split(':').map(Number);
      const newSlotDT = new Date(newDate);
      newSlotDT.setHours(rh, rm, 0, 0);
      if (newSlotDT <= new Date()) {
        return res.status(400).json({ success: false, message: 'You cannot reschedule to a past date or time.' });
      }

      // Doctor-side conflict check (exclude self)
      const doctorConflict = await Appointment.hasConflict(
        appointment.doctor, newDate, newTime, dur, appointment._id
      );
      if (doctorConflict) {
        return res.status(409).json({ success: false, message: 'This doctor is fully booked for the selected time slot.' });
      }

      // Patient-side conflict check (exclude self)
      const patientConflict = await Appointment.hasPatientConflict(
        appointment.patient, newDate, newTime, dur, appointment._id
      );
      if (patientConflict) {
        return res.status(409).json({ success: false, message: 'You already have an overlapping appointment at this time.' });
      }

      appointment.appointmentDate = newDate;
      appointment.appointmentTime = newTime;
    }

    // Apply other allowed field updates
    Object.keys(req.body).forEach(key => {
      if (userAllowedUpdates.includes(key) && req.body[key] !== undefined) {
        if (key.includes('.')) {
          const [parent, child] = key.split('.');
          if (!appointment[parent]) appointment[parent] = {};
          appointment[parent][child] = req.body[key];
        } else {
          appointment[key] = req.body[key];
        }
      }
    });

    await appointment.save();

    await appointment.populate([
      { path: 'patient', select: 'firstName lastName email phone' },
      { path: 'doctor', select: 'firstName lastName specialization department' }
    ]);

    res.json({ success: true, message: 'Appointment updated successfully', data: { appointment } });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Statuses that cannot be cancelled (already in active workflow or terminal)
const NON_CANCELLABLE_STATUSES = [
  'checked_in', 'in_queue', 'in_consultation', 'in-progress',
  'completed', 'cancelled', 'no-show', 'rescheduled'
];

// @desc    Cancel appointment
// @route   DELETE /api/appointments/:id
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    // Check authorization
    const canCancel =
      appointment.patient.toString() === req.user.id ||
      ['receptionist', 'staff', 'admin'].includes(req.user.role);

    if (!canCancel) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this appointment' });
    }

    // Non-admin roles cannot cancel once the patient is in the active workflow
    if (req.user.role !== 'admin' && NON_CANCELLABLE_STATUSES.includes(appointment.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot cancel an appointment with status '${appointment.status}'. Please contact reception.`
      });
    }

    appointment.status = 'cancelled';
    appointment.cancellation = {
      cancelledBy: req.user.id,
      cancelledAt: new Date(),
      reason: req.body.reason || 'No reason provided'
    };

    await appointment.save();

    // Release the time block slot so another patient can book it
    if (appointment.timeBlockId) {
      await TimeBlock.releaseAppointmentSlot(appointment.timeBlockId);
    }

    await appointment.populate([
      { path: 'patient', select: 'firstName lastName email phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization department' }
    ]);

    res.json({
      success: true,
      message: 'Appointment cancelled successfully',
      data: { appointment }
    });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Valid status transitions for appointment (non-admin roles)
const APPOINTMENT_TRANSITIONS = {
  // ── New flow statuses ──────────────────────────────────────────────────────
  booked:             ['checked_in', 'in_queue', 'cancelled', 'no-show', 'doctor-unavailable'],
  // ── Legacy / backward-compat statuses ─────────────────────────────────────
  scheduled:          ['booked', 'confirmed', 'cancelled', 'rescheduled', 'doctor-unavailable'],
  confirmed:          ['booked', 'checked_in', 'cancelled', 'rescheduled', 'doctor-unavailable'],
  checked_in:         ['in_queue', 'cancelled'],
  in_queue:           ['in_consultation', 'in-progress', 'skipped', 'no-show', 'delayed'],
  'in-progress':      ['in_consultation', 'completed'],
  in_consultation:    ['completed', 'skipped'],
  delayed:            ['in_queue', 'cancelled', 'no-show'],
  skipped:            ['in_queue', 'no-show', 'cancelled'],
  late:               ['in_queue', 'no-show', 'cancelled'],
  // Terminal statuses — no transitions allowed
  completed:          [],
  cancelled:          [],
  'no-show':          [],
  rescheduled:        [],
  'doctor-unavailable': ['rescheduled', 'cancelled', 'booked']
};

// @desc    Update appointment status
// @route   PATCH /api/appointments/:id/status
// @access  Private (Doctor, Staff, Admin)
router.patch('/:id/status',
  auth,
  authorize('doctor', 'staff', 'admin'),
  [
    body('status').isIn([
      'booked', 'scheduled', 'confirmed', 'checked_in', 'in_queue', 'in-progress',
      'in_consultation', 'completed', 'cancelled', 'rescheduled',
      'no-show', 'skipped', 'late', 'delayed', 'doctor-unavailable'
    ]).withMessage('Invalid status')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const appointment = await Appointment.findById(req.params.id);

      if (!appointment) {
        return res.status(404).json({ success: false, message: 'Appointment not found' });
      }

      const newStatus = req.body.status;
      const currentStatus = appointment.status;

      // Admins can force any transition; everyone else must follow the transition graph
      if (req.user.role !== 'admin') {
        const allowed = APPOINTMENT_TRANSITIONS[currentStatus] || [];
        if (!allowed.includes(newStatus)) {
          return res.status(409).json({
            success: false,
            message: `Cannot transition appointment from '${currentStatus}' to '${newStatus}'.`
          });
        }
      }

      appointment.status = newStatus;
      await appointment.save();

      await appointment.populate([
        { path: 'patient', select: 'firstName lastName email phone' },
        { path: 'doctor', select: 'firstName lastName specialization department' }
      ]);

      // Emit socket event for real-time update
      const io = req.app.get('io');
      if (io) {
        io.to(appointment.patient._id.toString()).emit('appointment-status-update', {
          appointmentId: appointment._id,
          status: appointment.status,
          message: `Your appointment status has been updated to ${appointment.status}`
        });
      }

      res.json({
        success: true,
        message: 'Appointment status updated successfully',
        data: { appointment }
      });
    } catch (error) {
      console.error('Update appointment status error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  }
);

// @desc    Legacy check-in stub — real check-in is POST /api/check-in/appointment
// @route   POST /api/appointments/:id/checkin
// @access  Private (Staff, Admin)
// This route only marks the appointment as confirmed (pre-arrival confirmation).
// It does NOT create a QueueEntry or assign a token.
// Use POST /api/check-in/appointment for the full check-in workflow.
router.post('/:id/checkin', auth, authorize('receptionist', 'staff', 'admin'), async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    if (['cancelled', 'completed', 'no-show', 'rescheduled'].includes(appointment.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot confirm an appointment with status '${appointment.status}'.`
      });
    }

    if (['checked_in', 'in_queue', 'in_consultation', 'in-progress'].includes(appointment.status)) {
      return res.status(409).json({
        success: false,
        message: 'Appointment is already checked in. Use POST /api/check-in/appointment for full check-in with queue entry.',
        data: { currentStatus: appointment.status }
      });
    }

    appointment.checkIn = {
      time: new Date(),
      method: req.body.method || 'manual',
      verifiedBy: req.user.id
    };
    appointment.status = 'confirmed';
    await appointment.save();

    await appointment.populate([
      { path: 'patient', select: 'firstName lastName email phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization department' }
    ]);

    res.json({
      success: true,
      message: 'Appointment confirmed. To assign a queue token, use POST /api/check-in/appointment.',
      data: { appointment }
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @desc    Get patient's appointments
// @route   GET /api/appointments/patient/:patientId
// @access  Private
router.get('/patient/:patientId', auth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { status, limit = 50 } = req.query;
    
    // Check if user can access this patient's appointments
    if (req.user.role === 'patient' && req.user.id !== patientId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access these appointments'
      });
    }
    
    let query = { patient: patientId };
    
    // Filter by status if provided
    if (status) {
      const statusArray = status.split(',');
      query.status = { $in: statusArray };
    }
    
    const appointments = await Appointment.find(query)
      .populate('doctor', 'firstName lastName specialization email phone')
      .populate('patient', 'firstName lastName email phone')
      .sort({ appointmentDate: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      data: {
        appointments,
        count: appointments.length
      }
    });
  } catch (error) {
    console.error('Get patient appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get doctor's appointments
// @route   GET /api/appointments/doctor/:doctorId
// @access  Private
router.get('/doctor/:doctorId', auth, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { status, date, limit = 50 } = req.query;
    
    // Check if user can access this doctor's appointments
    if (req.user.role === 'doctor' && req.user.id !== doctorId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access these appointments'
      });
    }
    
    let query = { doctor: doctorId };
    
    // Filter by status if provided
    if (status) {
      const statusArray = status.split(',');
      query.status = { $in: statusArray };
    }
    
    // Filter by date if provided
    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      query.appointmentDate = { $gte: startDate, $lt: endDate };
    }
    
    const appointments = await Appointment.find(query)
      .populate('doctor', 'firstName lastName specialization email phone')
      .populate('patient', 'firstName lastName email phone dateOfBirth')
      .sort({ appointmentDate: 1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      data: {
        appointments,
        count: appointments.length
      }
    });
  } catch (error) {
    console.error('Get doctor appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;