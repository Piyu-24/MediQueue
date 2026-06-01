const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const QueueEntry = require('../models/QueueEntry');
const User = require('../models/User');
const HealthCard = require('../models/HealthCard');
const Appointment = require('../models/Appointment');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const auditLog = require('../middleware/auditLog');

const router = express.Router();

// Rate limiter: max 20 check-ins per minute per IP (prevents receptionist spam)
const checkinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { success: false, message: 'Too many check-in requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Returns today's date as YYYY-MM-DD in local time */
const todayStr = () => new Date().toISOString().split('T')[0];

// ─────────────────────────────────────────────────────────────────────────────
// RECEPTIONIST — Check a patient into the queue
// POST /api/queue/checkin
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/checkin',
  checkinLimiter,
  auth,
  authorize('receptionist', 'staff', 'admin'),
  auditLog('QUEUE_CHECKIN', 'QueueEntry'),
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
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const {
        patientId,
        doctorId,
        room,
        department,
        appointmentId,
        isWalkIn = false,
        notes,
        priority = 'normal'
      } = req.body;

      const queueDate = todayStr();

      // ── 1. Validate patient exists ──────────────────────────────────────────
      const patient = await User.findById(patientId);
      if (!patient || patient.role !== 'patient') {
        return res.status(404).json({ success: false, message: 'Patient not found' });
      }

      // ── 2. Validate doctor exists ───────────────────────────────────────────
      const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true });
      if (!doctor) {
        return res.status(404).json({ success: false, message: 'Doctor not found' });
      }

      // ── 3. Prevent duplicate active queue entry today ───────────────────────
      const existingEntry = await QueueEntry.findOne({
        patient: patientId,
        doctor: doctorId,
        queueDate,
        status: { $in: ['waiting', 'called', 'in-consultation'] }
      });

      if (existingEntry) {
        return res.status(409).json({
          success: false,
          message: 'Patient already has an active queue entry with this doctor today',
          data: { existingEntry }
        });
      }

      // ── 4. Generate queue number ────────────────────────────────────────────
      const { queueNumber, sequenceNumber } = await QueueEntry.generateQueueNumber(
        department,
        queueDate
      );

      // ── 5. Calculate ETA ────────────────────────────────────────────────────
      const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate);

      // ── 6. Validate linked appointment if provided ──────────────────────────
      let linkedAppointment = null;
      if (appointmentId) {
        linkedAppointment = await Appointment.findOne({
          _id: appointmentId,
          patient: patientId,
          doctor: doctorId
        });
        if (!linkedAppointment) {
          return res.status(404).json({
            success: false,
            message: 'Linked appointment not found or does not match patient/doctor'
          });
        }
        // Update appointment to confirmed/in-progress
        linkedAppointment.status = 'confirmed';
        linkedAppointment.checkIn = {
          time: new Date(),
          method: 'qr-code',
          verifiedBy: req.user.id
        };
        await linkedAppointment.save();
      }

      // ── 7. Create queue entry ───────────────────────────────────────────────
      const queueEntry = await QueueEntry.create({
        patient: patientId,
        doctor: doctorId,
        appointment: linkedAppointment ? linkedAppointment._id : null,
        checkedInBy: req.user.id,
        room,
        department,
        queueNumber,
        sequenceNumber,
        priority,
        isWalkIn,
        notes,
        estimatedWaitMinutes,
        checkInTime: new Date(),
        queueDate
      });

      await queueEntry.populate([
        { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
        { path: 'doctor', select: 'firstName lastName specialization' },
        { path: 'checkedInBy', select: 'firstName lastName' }
      ]);

      // ── 8. Emit real-time event ─────────────────────────────────────────────
      const io = req.app.get('io');
      if (io) {
        io.emit('queue:created', {
          queueEntry,
          department,
          room,
          queueDate
        });
        // Notify patient's browser if connected
        io.to(patientId).emit('queue:checkedIn', {
          queueNumber,
          room,
          department,
          estimatedWaitMinutes,
          position: sequenceNumber
        });
      }

      res.status(201).json({
        success: true,
        message: `Patient checked in successfully. Queue number: ${queueNumber}`,
        data: { queueEntry }
      });
    } catch (error) {
      console.error('Check-in error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error during check-in',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RECEPTIONIST / ADMIN — Validate QR + look up patient's today appointment
// POST /api/queue/validate-qr
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/validate-qr',
  auth,
  authorize('receptionist', 'staff', 'admin'),
  async (req, res) => {
    try {
      const { qrData, cardNumber } = req.body;

      let searchCardNumber = cardNumber;

      // Parse QR data if raw string provided
      if (qrData && !cardNumber) {
        try {
          const parsed = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
          searchCardNumber = parsed.cardNumber;
        } catch {
          searchCardNumber = qrData; // treat as raw card number
        }
      }

      if (!searchCardNumber) {
        return res.status(400).json({
          success: false,
          message: 'Card number or QR data required'
        });
      }

      console.log('Validating QR with searchCardNumber:', searchCardNumber);

      // Find health card
      const healthCard = await HealthCard.findOne({
        cardNumber: searchCardNumber.trim().toUpperCase()
      }).populate('patient', 'firstName lastName phone email dateOfBirth gender digitalHealthCardId');

      if (!healthCard) {
        return res.status(404).json({ success: false, message: 'Health card not found' });
      }

      const validation = healthCard.validateCard();

      // Log the scan access
      await healthCard.logAccess(req.user.id, 'scan', req.ip, 'Check-in QR scan');

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: `Health card invalid: ${validation.reason}`,
          data: { validation }
        });
      }

      const patient = healthCard.patient;
      const queueDate = todayStr();

      // Find today's appointments for this patient
      const startOfDay = new Date(queueDate);
      const endOfDay = new Date(queueDate);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const todaysAppointments = await Appointment.find({
        patient: patient._id,
        appointmentDate: { $gte: startOfDay, $lt: endOfDay },
        status: { $in: ['scheduled', 'confirmed'] }
      }).populate('doctor', 'firstName lastName specialization department');

      // Check if already in queue today
      const existingQueueEntries = await QueueEntry.find({
        patient: patient._id,
        queueDate,
        status: { $in: ['waiting', 'called', 'in-consultation'] }
      }).populate('doctor', 'firstName lastName');

      res.json({
        success: true,
        message: 'Health card validated successfully',
        data: {
          patient,
          healthCard: {
            cardNumber: healthCard.cardNumber,
            status: healthCard.status,
            bloodGroup: healthCard.bloodGroup,
            expiryDate: healthCard.expiryDate
          },
          todaysAppointments,
          existingQueueEntries,
          alreadyCheckedIn: existingQueueEntries.length > 0
        }
      });
    } catch (error) {
      console.error('QR validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// ALL STAFF — Get queue list with filters
// GET /api/queue?date=2024-01-15&room=Room+01&department=General+OPD&status=waiting
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, authorize('receptionist', 'staff', 'doctor', 'admin', 'manager'), async (req, res) => {
  try {
    const {
      date = todayStr(),
      room,
      department,
      status,
      doctorId
    } = req.query;

    const query = { queueDate: date };

    // Doctors only see their own queue
    if (req.user.role === 'doctor') {
      query.doctor = req.user.id;
    } else {
      if (doctorId) query.doctor = doctorId;
    }

    if (room) query.room = room;
    if (department) query.department = department;
    if (status) {
      const statusList = status.split(',');
      query.status = { $in: statusList };
    }

    const queueEntries = await QueueEntry.find(query)
      .populate('patient', 'firstName lastName phone digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization')
      .populate('checkedInBy', 'firstName lastName')
      .sort({ sequenceNumber: 1 });

    res.json({
      success: true,
      count: queueEntries.length,
      data: { queueEntries }
    });
  } catch (error) {
    console.error('Get queue error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — Display screen data (anonymized)
// GET /api/queue/display?date=2024-01-15
// No auth required — this is the public kiosk screen data
// ─────────────────────────────────────────────────────────────────────────────
router.get('/display', async (req, res) => {
  try {
    const date = req.query.date || todayStr();

    // Get all active entries grouped by room
    const entries = await QueueEntry.find({
      queueDate: date,
      status: { $in: ['waiting', 'called', 'in-consultation', 'completed'] }
    })
      .populate('patient', 'firstName lastName')  // only for initials — not exposed in response
      .populate('doctor', 'firstName lastName specialization')
      .sort({ room: 1, sequenceNumber: 1 })
      .lean();

    // Group by room and build anonymized display data
    const roomMap = {};
    for (const entry of entries) {
      if (!roomMap[entry.room]) {
        roomMap[entry.room] = {
          room: entry.room,
          department: entry.department,
          doctor: entry.doctor
            ? `Dr. ${entry.doctor.firstName} ${entry.doctor.lastName}`
            : 'TBD',
          nowServing: null,
          upNext: [],
          completedCount: 0
        };
      }

      const rm = roomMap[entry.room];

      // Anonymized display: show queue number + patient initials only
      const initials = entry.patient
        ? `${entry.patient.firstName.charAt(0)}.${entry.patient.lastName.charAt(0)}.`
        : '??.';

      const displayEntry = {
        queueNumber: entry.queueNumber,
        initials,
        status: entry.status,
        priority: entry.priority
      };

      if (entry.status === 'in-consultation' || entry.status === 'called') {
        rm.nowServing = displayEntry;
      } else if (entry.status === 'waiting') {
        rm.upNext.push(displayEntry);
      } else if (entry.status === 'completed') {
        rm.completedCount += 1;
      }
    }

    // Limit upNext to 5 entries per room
    for (const room of Object.values(roomMap)) {
      room.upNext = room.upNext.slice(0, 5);
    }

    res.json({
      success: true,
      data: {
        date,
        rooms: Object.values(roomMap),
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Display error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT — Get own queue status today
// GET /api/queue/my-status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my-status', auth, authorize('patient'), async (req, res) => {
  try {
    const queueDate = todayStr();

    const entry = await QueueEntry.findOne({
      patient: req.user.id,
      queueDate,
      status: { $in: ['waiting', 'called', 'in-consultation'] }
    })
      .populate('doctor', 'firstName lastName specialization')
      .lean();

    if (!entry) {
      return res.json({
        success: true,
        data: { inQueue: false }
      });
    }

    // Calculate current position (how many waiting before this patient)
    const patientsAhead = await QueueEntry.countDocuments({
      doctor: entry.doctor._id,
      queueDate,
      status: 'waiting',
      sequenceNumber: { $lt: entry.sequenceNumber }
    });

    const estimatedWait = patientsAhead * (entry.avgConsultationMinutes || 10);

    res.json({
      success: true,
      data: {
        inQueue: true,
        queueNumber: entry.queueNumber,
        status: entry.status,
        room: entry.room,
        department: entry.department,
        doctor: entry.doctor,
        position: patientsAhead + 1,
        estimatedWaitMinutes: estimatedWait,
        checkInTime: entry.checkInTime
      }
    });
  } catch (error) {
    console.error('My status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / MANAGER — Stats for today
// GET /api/queue/stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', auth, authorize('admin', 'manager', 'staff', 'receptionist'), async (req, res) => {
  try {
    const date = req.query.date || todayStr();

    const [waiting, called, inConsultation, completed, noShow, total] = await Promise.all([
      QueueEntry.countDocuments({ queueDate: date, status: 'waiting' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'called' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'in-consultation' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'completed' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'no-show' }),
      QueueEntry.countDocuments({ queueDate: date })
    ]);

    // Average consultation duration from completed entries today
    const completedEntries = await QueueEntry.find({
      queueDate: date,
      status: 'completed',
      consultationStartTime: { $exists: true },
      consultationEndTime: { $exists: true }
    }).select('consultationStartTime consultationEndTime');

    let avgConsultationMinutes = 0;
    if (completedEntries.length > 0) {
      const totalMinutes = completedEntries.reduce((sum, e) => {
        return sum + Math.round((e.consultationEndTime - e.consultationStartTime) / 60000);
      }, 0);
      avgConsultationMinutes = Math.round(totalMinutes / completedEntries.length);
    }

    // Average wait time (check-in to called)
    const calledEntries = await QueueEntry.find({
      queueDate: date,
      calledTime: { $exists: true },
      checkInTime: { $exists: true }
    }).select('checkInTime calledTime');

    let avgWaitMinutes = 0;
    if (calledEntries.length > 0) {
      const totalWait = calledEntries.reduce((sum, e) => {
        return sum + Math.round((e.calledTime - e.checkInTime) / 60000);
      }, 0);
      avgWaitMinutes = Math.round(totalWait / calledEntries.length);
    }

    res.json({
      success: true,
      data: {
        date,
        stats: {
          total,
          waiting,
          called,
          inConsultation,
          completed,
          noShow,
          active: waiting + called + inConsultation,
          avgConsultationMinutes,
          avgWaitMinutes
        }
      }
    });
  } catch (error) {
    console.error('Queue stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Call next patient  (waiting → called)
// PATCH /api/queue/:id/call
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/call', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (entry.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: `Cannot call patient — current status is '${entry.status}'`
      });
    }

    // Doctors can only call patients from their own queue
    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    entry.status = 'called';
    entry.calledTime = new Date();
    await entry.save();

    await entry.populate([
      { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:called', { queueEntry: entry, room: entry.room });
      io.to(entry.patient._id.toString()).emit('queue:yourTurn', {
        queueNumber: entry.queueNumber,
        room: entry.room,
        message: `It's your turn! Please proceed to ${entry.room}`
      });
    }

    res.json({ success: true, message: 'Patient called', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Call patient error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Start consultation  (called → in-consultation)
// PATCH /api/queue/:id/start
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/start', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['called', 'waiting'].includes(entry.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot start — current status is '${entry.status}'`
      });
    }

    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    entry.status = 'in-consultation';
    entry.consultationStartTime = new Date();
    if (!entry.calledTime) entry.calledTime = new Date();
    await entry.save();

    await entry.populate([
      { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:updated', { queueEntry: entry, room: entry.room });
    }

    res.json({ success: true, message: 'Consultation started', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Start consultation error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Complete consultation  (in-consultation → completed)
// PATCH /api/queue/:id/complete
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/complete', auth, authorize('doctor', 'admin'), auditLog('QUEUE_COMPLETE', 'QueueEntry'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['in-consultation', 'called'].includes(entry.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete — current status is '${entry.status}'`
      });
    }

    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    entry.status = 'completed';
    entry.consultationEndTime = new Date();
    if (!entry.consultationStartTime) entry.consultationStartTime = new Date();
    await entry.save();

    // Also update linked appointment status if exists
    if (entry.appointment) {
      await Appointment.findByIdAndUpdate(entry.appointment, { status: 'completed' });
    }

    await entry.populate([
      { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:completed', { queueEntry: entry, room: entry.room });
      io.emit('queue:display:update', { room: entry.room, date: entry.queueDate });
    }

    res.json({ success: true, message: 'Consultation completed', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Complete consultation error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR / RECEPTIONIST — Mark no-show
// PATCH /api/queue/:id/no-show
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/no-show', auth, authorize('doctor', 'receptionist', 'staff', 'admin'), auditLog('QUEUE_NO_SHOW', 'QueueEntry'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['waiting', 'called'].includes(entry.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark no-show — current status is '${entry.status}'`
      });
    }

    entry.status = 'no-show';
    entry.noShowTime = new Date();
    await entry.save();

    // Update linked appointment too
    if (entry.appointment) {
      await Appointment.findByIdAndUpdate(entry.appointment, { status: 'no-show' });
    }

    await entry.populate([
      { path: 'patient', select: 'firstName lastName phone' },
      { path: 'doctor', select: 'firstName lastName' }
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:updated', { queueEntry: entry, room: entry.room });
    }

    res.json({ success: true, message: 'Marked as no-show', data: { queueEntry: entry } });
  } catch (error) {
    console.error('No-show error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
