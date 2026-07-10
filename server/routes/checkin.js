const express    = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit  = require('express-rate-limit');
const auth       = require('../middleware/auth');
const authorize  = require('../middleware/authorize');
const { getAppointmentEligibility, checkInAppointment, checkInWalkIn } = require('../services/CheckInService');
const QueueEngine = require('../services/QueueEngine');
const { localDateStr } = require('../services/TokenGenerator');
const Appointment = require('../models/Appointment');
const DoctorQueueSession = require('../models/DoctorQueueSession');

const router = express.Router();

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many check-in requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/check-in/eligibility/:appointmentId
// Check if a patient can check in for their appointment right now.
// Also returns appointment token info for new-flow appointments.
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
        eligible:                result.eligible,
        reason:                  result.reason,
        arrivalStatus:           result.arrivalStatus,
        minutesUntilAppointment: result.minutesUntilAppointment,
        alreadyCheckedIn:        result.alreadyCheckedIn || false,
        policy: result.policy ? {
          earlyCheckInMinutes: result.policy.earlyCheckInMinutes,
          gracePeriodMinutes:  result.policy.gracePeriodMinutes
        } : null,
        appointment: result.appointment ? {
          appointmentReference: result.appointment.appointmentReference,
          appointmentDate:      result.appointment.appointmentDate,
          appointmentTime:      result.appointment.appointmentTime,
          bookingType:          result.appointment.bookingType,
          // Token info for new-flow appointments
          appointmentToken:     result.appointment.appointmentToken,
          tokenNumber:          result.appointment.tokenNumber,
          reportingTime:        result.appointment.reportingTime,
          timeBlockId:          result.appointment.timeBlockId,
          departmentId:         result.appointment.departmentId,
          doctor:               result.appointment.doctor,
          status:               result.appointment.status
        } : null
      }
    });
  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/check-in/appointment
// Check in a booked appointment patient.
//
// NEW FLOW (block-based, bookingType='general_opd'):
//   - appointment.appointmentToken already set at booking
//   - doctorId assigned HERE by reception (required)
//   - departmentId optional (derived from appointment if not provided)
//
// LEGACY FLOW (exact-time specialist):
//   - doctorId is the same doctor from booking
//   - A token generated at this point
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/appointment',
  checkinLimiter,
  auth,
  authorize('receptionist', 'staff', 'admin'),
  [
    body('appointmentId').isMongoId().withMessage('Valid appointment ID required'),
    body('patientId').isMongoId().withMessage('Valid patient ID required'),
    // doctorId is required — reception must assign a doctor even for General OPD
    body('doctorId').isMongoId().withMessage('Valid doctor ID required — reception must assign a doctor at check-in'),
    body('room').notEmpty().withMessage('Room is required'),
    body('department').notEmpty().withMessage('Department name is required'),
    // Optional new-flow fields
    body('departmentId').optional().isMongoId().withMessage('Invalid departmentId'),
    body('timeBlockId').optional().isMongoId().withMessage('Invalid timeBlockId')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const {
        appointmentId,
        patientId,
        doctorId,
        room,
        department,
        departmentId,
        timeBlockId,
        notes,
        priority
      } = req.body;

      // ── Session-closed guard ───────────────────────────────────────────
      // Once a doctor closes their session, no further check-ins are accepted.
      const queueDate = localDateStr();
      const checkinSession = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate }).lean();
      if (checkinSession?.status === 'ended') {
        return res.status(409).json({
          success: false,
          message: 'Check-in is closed. The clinic session for this doctor has ended for today. Please inform the patient that no further appointments are being accepted.',
          data: { sessionStatus: 'ended' }
        });
      }

      const result = await checkInAppointment({
        appointmentId,
        patientId,
        performedById:   req.user.id,
        performedByRole: req.user.role,
        room,
        department,
        doctorId,
        departmentId,
        timeBlockId,
        notes,
        priority
      });

      // Recalculate queue after check-in
      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, queueDate, io);

      const arrivalMsg = {
        early:   'Patient checked in early. Token activated.',
        on_time: 'Patient checked in on time. Token activated.',
        late:    `Patient checked in late. Token ${result.token} inserted according to late-arrival policy.`
      }[result.arrivalStatus] || `Patient checked in. Token ${result.token} assigned.`;

      const isNewFlow = !!result.appointment?.appointmentToken;
      const patientMessage = result.arrivalStatus === 'late'
        ? `You have checked in after your reporting time. Your token ${result.token} is still valid. You will be called after the current consultation according to hospital late-arrival policy.`
        : `Your token ${result.token} is now active. Please watch the display board. You will be called according to hospital queue priority.`;

      res.status(201).json({
        success: true,
        message: arrivalMsg,
        data: {
          queueEntry:          result.queueEntry,
          token:               result.token,
          arrivalStatus:       result.arrivalStatus,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          isNewFlow,
          patientMessage,
          displayMessage: `Token No: ${result.token}. ${isNewFlow ? 'Token activated from booking.' : 'Token assigned at check-in.'} Please watch the display board.`
        }
      });
    } catch (error) {
      console.error('Appointment check-in error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server error during check-in',
        data:    error.data
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/check-in/appointment/by-token
// Check in using an appointment token (e.g. scan token slip QR code).
// Looks up the appointment by token string, then delegates to the normal check-in.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/appointment/by-token',
  checkinLimiter,
  auth,
  authorize('receptionist', 'staff', 'admin'),
  [
    body('appointmentToken').notEmpty().withMessage('Appointment token is required (e.g. A014)'),
    body('doctorId').isMongoId().withMessage('Valid doctor ID required'),
    body('room').notEmpty().withMessage('Room is required'),
    body('department').notEmpty().withMessage('Department name is required'),
    body('departmentId').optional().isMongoId()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { appointmentToken, doctorId, room, department, departmentId, notes, priority } = req.body;

      // Find appointment by token — only active (not yet checked-in) appointments
      const appointment = await Appointment.findOne({
        appointmentToken: appointmentToken.toUpperCase(),
        status: { $in: ['booked', 'scheduled', 'confirmed'] }
      }).populate('patient', 'firstName lastName phone');

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: `No active appointment found for token ${appointmentToken.toUpperCase()}. It may already be checked in or cancelled.`
        });
      }

      // ── Session-closed guard ───────────────────────────────────────────
      const queueDate = localDateStr();
      const byTokenSession = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate }).lean();
      if (byTokenSession?.status === 'ended') {
        return res.status(409).json({
          success: false,
          message: 'Check-in is closed. The clinic session for this doctor has ended for today. Please inform the patient that no further appointments are being accepted.',
          data: { sessionStatus: 'ended' }
        });
      }

      const result = await checkInAppointment({
        appointmentId:   appointment._id.toString(),
        patientId:       appointment.patient._id.toString(),
        performedById:   req.user.id,
        performedByRole: req.user.role,
        room,
        department,
        doctorId,
        departmentId:    departmentId || appointment.departmentId?.toString(),
        timeBlockId:     appointment.timeBlockId?.toString(),
        notes,
        priority
      });

      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, queueDate, io);

      res.status(201).json({
        success: true,
        message: `Token ${result.token} activated. Patient: ${appointment.patient.firstName} ${appointment.patient.lastName}.`,
        data: {
          queueEntry:           result.queueEntry,
          token:                result.token,
          arrivalStatus:        result.arrivalStatus,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          patient: {
            id:        appointment.patient._id,
            firstName: appointment.patient.firstName,
            lastName:  appointment.patient.lastName,
            phone:     appointment.patient.phone
          }
        }
      });
    } catch (error) {
      console.error('Token check-in error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server error during token check-in',
        data:    error.data
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/check-in/walk-in
// Register and check in a walk-in patient (W token from shared A/W sequence).
// departmentId is preferred over department string for proper token scoping.
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
    body('department').notEmpty().withMessage('Department name is required'),
    body('departmentId').optional().isMongoId().withMessage('Invalid departmentId')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { patientId, doctorId, room, department, departmentId, notes, isEmergency, priority } = req.body;

      // ── Session-closed guard ───────────────────────────────────────────
      // Emergency walk-ins always bypass this check.
      if (isEmergency !== true) {
        const queueDate = localDateStr();
        const existingSession = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate }).lean();
        if (existingSession?.status === 'ended') {
          return res.status(409).json({
            success: false,
            message: 'Walk-in registration is closed. The clinic session for this doctor has ended for today.'
          });
        }
      }

      const result = await checkInWalkIn({
        patientId,
        performedById:   req.user.id,
        performedByRole: req.user.role,
        room,
        department,
        departmentId,
        doctorId,
        notes,
        isEmergency: isEmergency === true,
        priority
      });

      const queueDate = localDateStr();
      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, queueDate, io);

      const isEmerg = isEmergency === true;

      res.status(201).json({
        success: true,
        message: isEmerg
          ? 'Emergency patient added to queue with highest priority.'
          : 'Walk-in patient checked in. Token assigned.',
        data: {
          queueEntry:           result.queueEntry,
          token:                result.token,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          patientMessage: isEmerg
            ? `Emergency Token: ${result.token}. Patient has been placed at the top of the queue.`
            : `Your walk-in token is ${result.token}. Walk-in patients are called based on doctor availability, appointment load, and urgency. Please watch the display board.`
        }
      });
    } catch (error) {
      console.error('Walk-in check-in error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Server error during walk-in check-in',
        data:    error.data
      });
    }
  }
);

module.exports = router;
