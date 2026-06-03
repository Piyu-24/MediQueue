const express = require('express');
const { body, query: queryValidator, validationResult } = require('express-validator');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { getSlotAvailability, getAvailableDoctors, checkBookingEligibility } = require('../services/AvailabilityService');

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
// Return slot-level availability grid for a doctor/date.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/availability',
  [
    queryValidator('doctorId').isMongoId().withMessage('Valid doctorId is required'),
    queryValidator('date').isISO8601().withMessage('Valid date is required (YYYY-MM-DD)'),
    queryValidator('patientId').optional().isMongoId()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { doctorId, date, patientId } = req.query;
      const result = await getSlotAvailability(doctorId, date, patientId || null);

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Slot availability error:', error);
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

    query.status = { $in: ['scheduled', 'confirmed', 'checked_in', 'in_queue'] };

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
// @access  Private (Patient)
router.post('/', auth, authorize('patient'), [
  body('doctor').isMongoId().withMessage('Valid doctor ID is required'),
  body('appointmentDate').isISO8601().withMessage('Valid appointment date is required'),
  body('appointmentTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format required (HH:MM)'),
  body('appointmentType').isIn(['consultation', 'follow-up', 'check-up', 'emergency', 'routine']),
  body('chiefComplaint').isLength({ min: 10, max: 500 }).withMessage('Chief complaint must be between 10-500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { doctor, appointmentDate, appointmentTime, duration = 30, appointmentType, chiefComplaint, symptoms } = req.body;
    const patientId = req.user.id;

    // Verify doctor exists and is active
    const doctorUser = await User.findOne({ _id: doctor, role: 'doctor', isActive: true });
    if (!doctorUser) {
      return res.status(404).json({ success: false, message: 'Doctor not found or unavailable' });
    }

    // Prevent booking in the past
    const [h, m] = appointmentTime.split(':').map(Number);
    const slotDateTime = new Date(appointmentDate);
    slotDateTime.setHours(h, m, 0, 0);
    if (slotDateTime <= new Date()) {
      return res.status(400).json({ success: false, message: 'You cannot book an appointment in the past.' });
    }

    // Check doctor availability: working schedule, DoctorSlot blocks, slot capacity
    const dateStr = new Date(appointmentDate).toISOString().split('T')[0];
    const eligibility = await checkBookingEligibility(doctor, dateStr, appointmentTime, duration);
    if (!eligibility.available) {
      const statusCode = eligibility.reason?.includes('fully booked') ? 409 : 400;
      return res.status(statusCode).json({ success: false, message: eligibility.reason });
    }

    // Doctor-side time overlap (prevents overbooking within a single-capacity slot)
    const doctorConflict = await Appointment.hasConflict(doctor, appointmentDate, appointmentTime, duration);
    if (doctorConflict) {
      return res.status(409).json({ success: false, message: 'This doctor is fully booked for the selected time slot.' });
    }

    // Patient-side conflict (prevents same patient booking overlapping slots)
    const patientConflict = await Appointment.hasPatientConflict(patientId, appointmentDate, appointmentTime, duration);
    if (patientConflict) {
      return res.status(409).json({ success: false, message: 'You already have an overlapping appointment at this time.' });
    }

    // If this is a reschedule, validate the source appointment belongs to this patient
    const { rescheduledFromAppointmentId } = req.body;
    if (rescheduledFromAppointmentId) {
      const sourceAppt = await Appointment.findOne({ _id: rescheduledFromAppointmentId, patient: patientId });
      if (!sourceAppt) {
        return res.status(404).json({ success: false, message: 'Source appointment not found for reschedule.' });
      }
    }

    // Create appointment — partial unique index is the final DB-level guard
    let appointment;
    try {
      appointment = await Appointment.create({
        patient: patientId,
        doctor,
        appointmentDate,
        appointmentTime,
        duration,
        appointmentType,
        chiefComplaint,
        symptoms: symptoms || [],
        status: 'scheduled',
        rescheduledFromAppointmentId: rescheduledFromAppointmentId || null
      });
    } catch (createErr) {
      if (createErr.code === 11000) {
        return res.status(409).json({ success: false, message: 'You already have an appointment at this time.' });
      }
      throw createErr;
    }

    // If this is a reschedule, update the old appointment to 'rescheduled'
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

    res.status(201).json({
      success: true,
      message: `Appointment booked successfully. Reference: ${appointment.appointmentReference}. Your live queue token will be issued after check-in at the hospital.`,
      data: { appointment }
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

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

    // Check authorization
    const isAuthorized = 
      appointment.patient._id.toString() === req.user.id ||
      appointment.doctor._id.toString() === req.user.id ||
      ['staff', 'manager', 'admin'].includes(req.user.role);

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
const NON_RESCHEDULABLE_STATUSES = [
  'checked_in', 'in_queue', 'in_consultation', 'in-progress',
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

    // Check authorization
    const canEdit =
      appointment.patient.toString() === req.user.id ||
      appointment.doctor.toString() === req.user.id ||
      ['staff', 'manager', 'admin'].includes(req.user.role);

    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this appointment' });
    }

    // Allowed fields for update based on role
    const allowedUpdates = {
      patient:  ['appointmentDate', 'appointmentTime', 'chiefComplaint', 'symptoms', 'notes.patient'],
      doctor:   ['status', 'notes.doctor', 'prescription', 'vitalSigns', 'diagnosis', 'labTests', 'referrals', 'followUp'],
      staff:    ['status', 'checkIn', 'room', 'notes.staff'],
      manager:  ['status', 'room', 'department'],
      admin:    ['status', 'room', 'department', 'appointmentDate', 'appointmentTime']
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
      ['staff', 'manager', 'admin'].includes(req.user.role);

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
  scheduled:          ['confirmed', 'cancelled', 'rescheduled', 'doctor-unavailable'],
  confirmed:          ['checked_in', 'cancelled', 'rescheduled', 'doctor-unavailable'],
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
  'doctor-unavailable': ['rescheduled', 'cancelled']
};

// @desc    Update appointment status
// @route   PATCH /api/appointments/:id/status
// @access  Private (Doctor, Staff, Admin)
router.patch('/:id/status',
  auth,
  authorize('doctor', 'staff', 'admin'),
  [
    body('status').isIn([
      'scheduled', 'confirmed', 'checked_in', 'in_queue', 'in-progress',
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
        io.to(appointment.patient.toString()).emit('appointment-status-update', {
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