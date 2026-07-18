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
const { ACTIVE_BOOKING_STATUSES } = require('../services/AvailabilityService');
const { getAvailableBlocks, isBookingCutoffReached } = require('../services/TimeBlockService');
const { nextAppointmentToken, buildScope } = require('../services/TokenSequenceService');

const router = express.Router();

// GET /api/appointments/availability
// Block-based availability for General OPD: patient selects a department + date,
// the response lists the bookable session blocks. Doctor assignment happens later
// at reception — patients never book a named doctor.
router.get('/availability',
  [
    queryValidator('date').isISO8601().withMessage('Valid date is required (YYYY-MM-DD)'),
    queryValidator('departmentId').isMongoId().withMessage('departmentId is required'),
    queryValidator('patientId').optional().isMongoId()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { departmentId, date, patientId } = req.query;

      const blocks = await getAvailableBlocks(departmentId, date, null, patientId || null);
      return res.json({
        success: true,
        mode: 'block',
        date,
        departmentId,
        data: blocks
      });
    } catch (error) {
      console.error('Availability error:', error);
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error' });
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
      // When a patient passes doctorId + date they are checking availability,
      // so show that doctor's appointments (which slots are taken)
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
      // Staff, Admin can query any appointments
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

    // Staff only check in patients, so don't send them clinical notes or contact info
    const isSupportStaff = req.user.role === 'staff';
    const patientFields = isSupportStaff
      ? 'firstName lastName digitalHealthCardId'
      : 'firstName lastName email phone digitalHealthCardId';

    let appointmentsQuery = Appointment.find(query)
      .populate('patient', patientFields)
      .populate('doctor', 'firstName lastName specialization department')
      .populate('timeBlockId', 'startTime endTime')
      .sort({ appointmentDate: 1, appointmentTime: 1 });

    if (isSupportStaff) {
      appointmentsQuery = appointmentsQuery.select('-chiefComplaint -symptoms -notes');
    }

    const appointments = await appointmentsQuery;

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

    // Default to today's date if none given (use local date, not UTC)
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

// @desc    Create appointment (General OPD)
// @route   POST /api/appointments
// @access  Private (Patient, Receptionist, Staff, Admin)
// Patient picks a department + session block, not a specific doctor.
// The token is given right away and the doctor is assigned at check-in.
router.post('/', auth, authorize('patient', 'receptionist', 'staff', 'admin'), [
  body('appointmentDate').isISO8601().withMessage('Please select a valid appointment date.'),
  body('appointmentType')
    .isIn(['consultation', 'follow-up', 'check-up', 'emergency', 'routine'])
    .withMessage('Invalid appointment type'),
  body('chiefComplaint')
    .isLength({ min: 5, max: 500 })
    .withMessage('Chief complaint must be between 5-500 characters'),
  body('departmentId').isMongoId().withMessage('A valid department is required'),
  body('timeBlockId').isMongoId().withMessage('A valid session is required'),
  // validate IDs coming from the client
  body('patientId').optional().isMongoId().withMessage('Invalid patientId'),
  body('rescheduledFromAppointmentId').optional().isMongoId().withMessage('Invalid rescheduledFromAppointmentId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const {
      departmentId,
      timeBlockId,
      appointmentDate,
      appointmentType,
      chiefComplaint,
      symptoms,
      rescheduledFromAppointmentId
    } = req.body;

    // Staff/admin/receptionist can book for a patient via patientId in the body.
    // Everyone else books for themselves.
    const patientId = (
      ['receptionist', 'staff', 'admin'].includes(req.user.role) && req.body.patientId
    ) ? req.body.patientId : req.user.id;

    // Make sure the patientId is a real active patient
    if (['receptionist', 'staff', 'admin'].includes(req.user.role) && req.body.patientId) {
      const patientUser = await User.findOne({ _id: patientId, role: 'patient', isActive: true });
      if (!patientUser) {
        return res.status(404).json({ success: false, message: 'Patient not found or account inactive.' });
      }
    }

    {
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

      // Make sure the time block really belongs to this department and date
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

      // Stop booking 30 mins before the session ends so the patient has time to arrive
      if (isBookingCutoffReached(dateStr, blockOwnership.endTime, 30)) {
        return res.status(409).json({
          success: false,
          message: 'Booking for this session has closed because there is not enough time to arrive before the doctor session ends. Please choose a later session or a different date.'
        });
      }

      // Don't let the same patient book the same session twice
      const isOPDDuplicate = await Appointment.hasOPDDuplicate(patientId, timeBlockId);
      if (isOPDDuplicate) {
        return res.status(409).json({
          success: false,
          message: 'You already have an appointment booked for this session. Please choose a different date or session.'
        });
      }

      // Rule 1: can't have two active appointments for the same department on the same day
      const sameDeptConflict = await Appointment.hasActiveSameDeptDayConflict(
        patientId, departmentId, appointmentDate
      );
      if (sameDeptConflict) {
        return res.status(409).json({
          success: false,
          message: 'You already have an active appointment for this department on this date. Please cancel or reschedule the existing appointment before booking another.'
        });
      }

      // Rule 2: the session can't overlap with an appointment in another department
      const timeOverlapConflict = await Appointment.hasActiveTimeBlockOverlap(
        patientId, departmentId, appointmentDate, blockOwnership.startTime, blockOwnership.endTime
      );
      if (timeOverlapConflict) {
        return res.status(409).json({
          success: false,
          message: 'You already have another appointment during this time. Please choose a non-conflicting time slot.'
        });
      }

      // Take one slot off the time block
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

      // Generate the A token
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
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Get dates where the patient already has a booking for a department
//          (used to mark those dates on the booking calendar)
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

      // Default range: today to 3 months ahead (same as the booking UI)
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

    // Check access - doctor can be null for General OPD appointments
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

// Once an appointment reaches one of these statuses it can't be rescheduled.
// 'booked' is included because a token/slot is already taken - the patient must cancel and rebook.
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

    // Check access - doctor can be null for General OPD appointments
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
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Valid status transitions for appointment (non-admin roles)
const APPOINTMENT_TRANSITIONS = {
  booked:             ['checked_in', 'in_queue', 'cancelled', 'no-show', 'doctor-unavailable'],
  // old statuses kept for backward compatibility
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
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Old check-in route - only marks the appointment as confirmed.
//          It does not create a queue entry or token.
//          The full check-in is POST /api/check-in/appointment.
// @route   POST /api/appointments/:id/checkin
// @access  Private (Staff, Admin)
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
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;