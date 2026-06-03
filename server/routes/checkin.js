const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { getAppointmentEligibility, checkInAppointment, checkInWalkIn } = require('../services/CheckInService');
const QueueEngine = require('../services/QueueEngine');
const { localDateStr } = require('../services/TokenGenerator');

const router = express.Router();

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many check-in requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/check-in/eligibility/:appointmentId
// Check if a patient can check in for their appointment right now.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/eligibility/:appointmentId', auth, async (req, res) => {
  try {
    const patientId =
      req.user.role === 'patient'
        ? req.user.id
        : req.query.patientId;

    if (!patientId) {
      return res.status(400).json({ success: false, message: 'patientId query param required for staff roles' });
    }

    const result = await getAppointmentEligibility(req.params.appointmentId, patientId);

    res.json({
      success: true,
      data: {
        eligible: result.eligible,
        reason: result.reason,
        arrivalStatus: result.arrivalStatus,
        minutesUntilAppointment: result.minutesUntilAppointment,
        alreadyCheckedIn: result.alreadyCheckedIn || false,
        policy: result.policy
          ? {
              earlyCheckInMinutes: result.policy.earlyCheckInMinutes,
              gracePeriodMinutes: result.policy.gracePeriodMinutes
            }
          : null,
        appointment: result.appointment
          ? {
              appointmentReference: result.appointment.appointmentReference,
              appointmentDate: result.appointment.appointmentDate,
              appointmentTime: result.appointment.appointmentTime,
              doctor: result.appointment.doctor,
              status: result.appointment.status
            }
          : null
      }
    });
  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/check-in/appointment
// Check in a booked appointment patient. Creates QueueEntry + updates Appointment.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/appointment',
  checkinLimiter,
  auth,
  authorize('receptionist', 'staff', 'admin'),
  [
    body('appointmentId').isMongoId().withMessage('Valid appointment ID required'),
    body('patientId').isMongoId().withMessage('Valid patient ID required'),
    body('doctorId').isMongoId().withMessage('Valid doctor ID required'),
    body('room').notEmpty().withMessage('Room is required'),
    body('department').notEmpty().withMessage('Department is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { appointmentId, patientId, doctorId, room, department, notes, priority } = req.body;

      const result = await checkInAppointment({
        appointmentId,
        patientId,
        performedById: req.user.id,
        performedByRole: req.user.role,
        room,
        department,
        doctorId,
        notes,
        priority
      });

      // Recalculate queue after check-in
      const queueDate = localDateStr();
      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, queueDate, io);

      const arrivalMsg = {
        early: 'Patient checked in early. Token assigned.',
        on_time: 'Patient checked in on time. Token assigned.',
        late: 'Patient checked in late. Token assigned with late-arrival priority.'
      }[result.arrivalStatus] || 'Patient checked in. Token assigned.';

      res.status(201).json({
        success: true,
        message: arrivalMsg,
        data: {
          queueEntry: result.queueEntry,
          token: result.token,
          arrivalStatus: result.arrivalStatus,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          message: `Token No: ${result.token}. Please watch the display board. Appointment patients, emergency cases, doctor delays, and consultation duration may affect waiting time.`
        }
      });
    } catch (error) {
      console.error('Appointment check-in error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server error during check-in',
        data: error.data
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/check-in/walk-in
// Register and check in a walk-in patient.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/walk-in',
  checkinLimiter,
  auth,
  authorize('receptionist', 'staff', 'admin'),
  [
    body('patientId').isMongoId().withMessage('Valid patient ID required'),
    body('doctorId').isMongoId().withMessage('Valid doctor ID required'),
    body('room').notEmpty().withMessage('Room is required'),
    body('department').notEmpty().withMessage('Department is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { patientId, doctorId, room, department, notes, isEmergency, priority } = req.body;

      const result = await checkInWalkIn({
        patientId,
        performedById: req.user.id,
        performedByRole: req.user.role,
        room,
        department,
        doctorId,
        notes,
        isEmergency: isEmergency === true,
        priority
      });

      const queueDate = localDateStr();
      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, queueDate, io);

      const patientTypeMsg = isEmergency
        ? 'Emergency patient added to queue with highest priority.'
        : 'Walk-in patient checked in. Token assigned.';

      res.status(201).json({
        success: true,
        message: patientTypeMsg,
        data: {
          queueEntry: result.queueEntry,
          token: result.token,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          message: isEmergency
            ? `Emergency Token: ${result.token}. Patient has been placed at the top of the queue.`
            : `Token No: ${result.token}. Your token number is used for calling. Appointment patients and emergency cases may be prioritized according to hospital policy. Please watch the display board.`
        }
      });
    } catch (error) {
      console.error('Walk-in check-in error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server error during walk-in check-in',
        data: error.data
      });
    }
  }
);

module.exports = router;
