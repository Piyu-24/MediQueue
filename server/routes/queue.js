const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const QueueEntry = require('../models/QueueEntry');
const QueueEventLog = require('../models/QueueEventLog');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const Consultation = require('../models/Consultation');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const HealthCard = require('../models/HealthCard');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const auditLog = require('../middleware/auditLog');
const QueueEngine = require('../services/QueueEngine');
const { localDateStr } = require('../services/TokenGenerator');

const router = express.Router();

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many check-in requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ─────────────────────────────────────────────────────────────────────────────
// RECEPTIONIST — Legacy direct check-in (kept for backward compatibility with
//   existing receptionist dashboard QR flow). New check-ins should use
//   POST /api/check-in/appointment or /api/check-in/walk-in instead.
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
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const {
        patientId, doctorId, room, department, appointmentId,
        isWalkIn = false, notes, priority = 'normal'
      } = req.body;

      const queueDate = localDateStr();

      const patient = await User.findById(patientId);
      if (!patient || patient.role !== 'patient') {
        return res.status(404).json({ success: false, message: 'Patient not found' });
      }

      const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true });
      if (!doctor) {
        return res.status(404).json({ success: false, message: 'Doctor not found' });
      }

      const existingEntry = await QueueEntry.findOne({
        patient: patientId,
        doctor: doctorId,
        queueDate,
        status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
      });
      if (existingEntry) {
        return res.status(409).json({
          success: false,
          message: 'Patient already has an active queue entry with this doctor today',
          data: { existingEntry }
        });
      }

      const tokenType = isWalkIn ? 'W' : 'A';
      const { queueNumber, sequenceNumber } = await QueueEntry.generateToken(doctorId, queueDate, tokenType);
      const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate);

      let linkedAppointment = null;
      if (appointmentId) {
        linkedAppointment = await Appointment.findOne({
          _id: appointmentId,
          patient: patientId,
          doctor: doctorId
        });
        if (!linkedAppointment) {
          return res.status(404).json({ success: false, message: 'Linked appointment not found' });
        }
        linkedAppointment.status = 'in_queue';
        linkedAppointment.checkIn = { time: new Date(), method: 'qr-code', verifiedBy: req.user.id };
        await linkedAppointment.save();
      }

      const queueEntry = await QueueEntry.create({
        patient: patientId,
        doctor: doctorId,
        appointment: linkedAppointment ? linkedAppointment._id : null,
        checkedInBy: req.user.id,
        room,
        department,
        queueNumber,
        sequenceNumber,
        tokenType,
        priority,
        isWalkIn,
        notes,
        estimatedWaitMinutes,
        checkInTime: new Date(),
        queueDate,
        status: 'waiting',
        zone: 'WAITING_POOL',
        appointmentTime: linkedAppointment?.appointmentTime || null
      });

      await QueueEventLog.create({
        queueEntryId: queueEntry._id,
        appointmentId: linkedAppointment?._id || null,
        doctorId,
        patientId,
        eventType: 'CHECKED_IN',
        newStatus: 'waiting',
        newZone: 'WAITING_POOL',
        performedBy: req.user.id,
        performedByRole: req.user.role,
        queueDate,
        remarks: `Legacy QR check-in. Token: ${queueNumber}`
      });

      await DoctorQueueSession.getOrCreate(doctorId, department, queueDate, room);

      await queueEntry.populate([
        { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
        { path: 'doctor', select: 'firstName lastName specialization' },
        { path: 'checkedInBy', select: 'firstName lastName' }
      ]);

      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, queueDate, io);

      if (io) {
        io.emit('queue:created', { queueEntry, department, room, queueDate });
        io.to(patientId).emit('queue:checkedIn', {
          queueNumber,
          room,
          department,
          estimatedWaitMinutes,
          message: `Token No: ${queueNumber}. Please watch the display board.`
        });
      }

      res.status(201).json({
        success: true,
        message: `Patient checked in. Token: ${queueNumber}`,
        data: { queueEntry }
      });
    } catch (error) {
      console.error('Check-in error:', error);
      res.status(500).json({ success: false, message: 'Server error during check-in' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RECEPTIONIST / ADMIN — Validate QR code
// POST /api/queue/validate-qr
// ─────────────────────────────────────────────────────────────────────────────
router.post('/validate-qr', auth, authorize('receptionist', 'staff', 'admin'), async (req, res) => {
  try {
    const { qrData, cardNumber } = req.body;
    let searchCardNumber = cardNumber;

    if (qrData && !cardNumber) {
      try {
        const parsed = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
        searchCardNumber = parsed.cardNumber;
      } catch {
        searchCardNumber = qrData;
      }
    }

    if (!searchCardNumber) {
      return res.status(400).json({ success: false, message: 'Card number or QR data required' });
    }

    const healthCard = await HealthCard.findOne({
      cardNumber: searchCardNumber.trim().toUpperCase()
    }).populate('patient', 'firstName lastName phone email dateOfBirth gender digitalHealthCardId');

    if (!healthCard) {
      return res.status(404).json({ success: false, message: 'Health card not found' });
    }

    const validation = healthCard.validateCard();
    await healthCard.logAccess(req.user.id, 'scan', req.ip, 'Check-in QR scan');

    if (!validation.valid) {
      return res.status(400).json({ success: false, message: `Health card invalid: ${validation.reason}`, data: { validation } });
    }

    const patient = healthCard.patient;
    const queueDate = localDateStr();
    const startOfDay = new Date(queueDate);
    const endOfDay = new Date(queueDate);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const [todaysAppointments, existingQueueEntries, allAppointments] = await Promise.all([
      Appointment.find({
        patient: patient._id,
        appointmentDate: { $gte: startOfDay, $lt: endOfDay },
        status: { $in: ['scheduled', 'confirmed'] }
      }).populate('doctor', 'firstName lastName specialization department'),
      QueueEntry.find({
        patient: patient._id,
        queueDate,
        status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
      }).populate('doctor', 'firstName lastName'),
      Appointment.find({ patient: patient._id })
        .populate('doctor', 'firstName lastName specialization department')
        .sort({ appointmentDate: 1, appointmentTime: 1 })
        .limit(50)
    ]);

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
        allAppointments,
        existingQueueEntries,
        alreadyCheckedIn: existingQueueEntries.length > 0
      }
    });
  } catch (error) {
    console.error('QR validation error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ALL STAFF — Get queue list with filters
// GET /api/queue
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, authorize('receptionist', 'staff', 'doctor', 'admin', 'manager'), async (req, res) => {
  try {
    const { date = localDateStr(), room, department, status, doctorId } = req.query;
    const query = { queueDate: date };

    if (req.user.role === 'doctor') {
      query.doctor = req.user.id;
    } else {
      if (doctorId) query.doctor = doctorId;
    }

    if (room) query.room = room;
    if (department) query.department = department;
    if (status) query.status = { $in: status.split(',') };

    const queueEntries = await QueueEntry.find(query)
      .populate('patient', 'firstName lastName phone digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization')
      .populate('checkedInBy', 'firstName lastName')
      .populate('appointment', 'appointmentReference appointmentTime')
      .sort({ sortOrder: 1, checkInTime: 1 });

    res.json({ success: true, count: queueEntries.length, data: { queueEntries } });
  } catch (error) {
    console.error('Get queue error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ALL STAFF — Get zone-aware queue view for a doctor
// GET /api/queue/doctors/:doctorId/active
// ─────────────────────────────────────────────────────────────────────────────
router.get('/doctors/:doctorId/active', auth, authorize('receptionist', 'staff', 'doctor', 'admin', 'manager'), async (req, res) => {
  try {
    const { doctorId } = req.params;
    const queueDate = req.query.date || localDateStr();

    if (req.user.role === 'doctor' && req.user.id !== doctorId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const view = await QueueEngine.getQueueView(doctorId, queueDate);
    res.json({ success: true, data: view });
  } catch (error) {
    console.error('Get active queue error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — Display screen data (anonymized)
// GET /api/queue/display
// ─────────────────────────────────────────────────────────────────────────────
router.get('/display', async (req, res) => {
  try {
    const date = req.query.date || localDateStr();

    const entries = await QueueEntry.find({
      queueDate: date,
      status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'completed', 'emergency_waiting'] }
    })
      .populate('patient', 'firstName lastName')
      .populate('doctor', 'firstName lastName specialization')
      .sort({ room: 1, sortOrder: 1 })
      .lean();

    // Fetch session pause/delay info per doctor
    const doctorIds = [...new Set(entries.map(e => e.doctor?._id?.toString()).filter(Boolean))];
    const sessions = await DoctorQueueSession.find({
      doctor: { $in: doctorIds },
      queueDate: date
    }).lean();
    const sessionMap = {};
    for (const s of sessions) sessionMap[s.doctor.toString()] = s;

    const roomMap = {};
    for (const entry of entries) {
      if (!roomMap[entry.room]) {
        const session = entry.doctor ? sessionMap[entry.doctor._id?.toString()] : null;
        roomMap[entry.room] = {
          room: entry.room,
          department: entry.department,
          doctor: entry.doctor ? `Dr. ${entry.doctor.firstName} ${entry.doctor.lastName}` : 'TBD',
          sessionStatus: session?.status || 'active',
          delayMessage: session?.delayMessage || null,
          nowServing: null,
          readyZone: [],
          upNext: [],
          completedCount: 0
        };
      }

      const rm = roomMap[entry.room];
      const initials = entry.patient
        ? `${entry.patient.firstName.charAt(0)}.${entry.patient.lastName.charAt(0)}.`
        : '??.';

      const displayEntry = {
        queueNumber: entry.queueNumber,
        tokenType: entry.tokenType,
        initials,
        status: entry.status,
        priority: entry.priority,
        zone: entry.zone
      };

      if (entry.status === 'in_consultation' || entry.status === 'called') {
        rm.nowServing = displayEntry;
      } else if (entry.zone === 'READY' || entry.status === 'ready') {
        rm.readyZone.push(displayEntry);
      } else if (entry.status === 'waiting' || entry.status === 'emergency_waiting') {
        rm.upNext.push(displayEntry);
      } else if (entry.status === 'completed') {
        rm.completedCount += 1;
      }
    }

    for (const room of Object.values(roomMap)) {
      room.upNext = room.upNext.slice(0, 5);
      room.readyZone = room.readyZone.slice(0, 3);
    }

    res.json({
      success: true,
      data: { date, rooms: Object.values(roomMap), lastUpdated: new Date().toISOString() }
    });
  } catch (error) {
    console.error('Display error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT — Own queue status
// GET /api/queue/my-status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my-status', auth, authorize('patient'), async (req, res) => {
  try {
    const queueDate = localDateStr();

    const entry = await QueueEntry.findOne({
      patient: req.user.id,
      queueDate,
      status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting', 'temporarily_away'] }
    })
      .populate('doctor', 'firstName lastName specialization')
      .populate('appointment', 'appointmentReference appointmentTime')
      .lean();

    if (!entry) {
      return res.json({ success: true, data: { inQueue: false } });
    }

    const session = await DoctorQueueSession.findOne({ doctor: entry.doctor._id, queueDate }).lean();

    res.json({
      success: true,
      data: {
        inQueue: true,
        queueNumber: entry.queueNumber,
        tokenType: entry.tokenType,
        status: entry.status,
        zone: entry.zone,
        room: entry.room,
        department: entry.department,
        doctor: entry.doctor,
        position: entry.patientsAheadCount + 1,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        checkInTime: entry.checkInTime,
        appointmentReference: entry.appointment?.appointmentReference || null,
        sessionStatus: session?.status || 'active',
        delayMessage: session?.delayMessage || null,
        message: `Token No: ${entry.queueNumber}. Please watch the display board. Appointment patients, emergency cases, doctor delays, and consultation duration may affect waiting time.`
      }
    });
  } catch (error) {
    console.error('My status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / MANAGER — Queue stats
// GET /api/queue/stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', auth, authorize('admin', 'manager', 'staff', 'receptionist'), async (req, res) => {
  try {
    const date = req.query.date || localDateStr();

    const [waiting, ready, inConsultation, completed, noShow, skipped, total] = await Promise.all([
      QueueEntry.countDocuments({ queueDate: date, status: 'waiting' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'ready' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'in_consultation' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'completed' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'no_show' }),
      QueueEntry.countDocuments({ queueDate: date, status: 'skipped' }),
      QueueEntry.countDocuments({ queueDate: date })
    ]);

    const completedEntries = await QueueEntry.find({
      queueDate: date,
      status: 'completed',
      consultationStartTime: { $exists: true },
      consultationEndTime: { $exists: true }
    }).select('consultationStartTime consultationEndTime');

    let avgConsultationMinutes = 0;
    if (completedEntries.length > 0) {
      const totalMinutes = completedEntries.reduce((sum, e) =>
        sum + Math.round((e.consultationEndTime - e.consultationStartTime) / 60000), 0);
      avgConsultationMinutes = Math.round(totalMinutes / completedEntries.length);
    }

    const calledEntries = await QueueEntry.find({
      queueDate: date,
      calledTime: { $exists: true },
      checkInTime: { $exists: true }
    }).select('checkInTime calledTime');

    let avgWaitMinutes = 0;
    if (calledEntries.length > 0) {
      const totalWait = calledEntries.reduce((sum, e) =>
        sum + Math.round((e.calledTime - e.checkInTime) / 60000), 0);
      avgWaitMinutes = Math.round(totalWait / calledEntries.length);
    }

    res.json({
      success: true,
      data: {
        date,
        stats: {
          total, waiting, ready, inConsultation, completed, noShow, skipped,
          active: waiting + ready + inConsultation,
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
// DOCTOR — Call next patient  (waiting/ready → called)
// PATCH /api/queue/:id/call
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/call', auth, authorize('doctor', 'receptionist', 'admin'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['waiting', 'ready', 'emergency_waiting'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot call — current status is '${entry.status}'` });
    }
    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    entry.status = 'called';
    entry.calledTime = new Date();
    await entry.save();

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'CALLED',
      oldStatus: 'ready',
      newStatus: 'called',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate
    });

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
// DOCTOR — Start consultation  (called/ready/waiting → in_consultation)
// PATCH /api/queue/:id/start
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/start', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['called', 'waiting', 'ready', 'emergency_waiting'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot start — current status is '${entry.status}'` });
    }
    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Prevent two simultaneous consultations for the same doctor
    const activeConsultation = await QueueEntry.findOne({
      doctor: entry.doctor,
      queueDate: entry.queueDate,
      status: 'in_consultation',
      _id: { $ne: entry._id }
    });
    if (activeConsultation && req.user.role !== 'admin') {
      return res.status(409).json({
        success: false,
        message: 'Doctor already has an active consultation. Complete or skip it before starting another.',
        data: { activeConsultation: activeConsultation._id }
      });
    }

    const oldStatus = entry.status;
    entry.status = 'in_consultation';
    entry.zone = 'CURRENT';
    entry.isLocked = true;
    entry.consultationStartTime = new Date();
    if (!entry.calledTime) entry.calledTime = new Date();
    await entry.save();

    // Update appointment status if linked
    if (entry.appointment) {
      await Appointment.findByIdAndUpdate(entry.appointment, { status: 'in_consultation' });
    }

    // Update session's current entry
    await DoctorQueueSession.findOneAndUpdate(
      { doctor: entry.doctor, queueDate: entry.queueDate },
      { currentQueueEntryId: entry._id }
    );

    // Create Consultation record
    await Consultation.create({
      queueEntry: entry._id,
      appointment: entry.appointment,
      doctor: entry.doctor,
      patient: entry.patient,
      queueDate: entry.queueDate,
      startedAt: entry.consultationStartTime,
      status: 'in_progress'
    });

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'CONSULTATION_STARTED',
      oldStatus,
      newStatus: 'in_consultation',
      oldZone: entry.zone,
      newZone: 'CURRENT',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate
    });

    await entry.populate([
      { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    const io = req.app.get('io');
    if (io) io.emit('queue:updated', { queueEntry: entry, room: entry.room });

    await QueueEngine.recalculate(entry.doctor.toString(), entry.queueDate, io);

    res.json({ success: true, message: 'Consultation started', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Start consultation error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Complete consultation  (in_consultation → completed)
// PATCH /api/queue/:id/complete
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/complete', auth, authorize('doctor', 'admin'), auditLog('QUEUE_COMPLETE', 'QueueEntry'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['in_consultation', 'called'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot complete — current status is '${entry.status}'` });
    }
    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    entry.status = 'completed';
    entry.zone = 'COMPLETED';
    entry.isLocked = false;
    entry.consultationEndTime = new Date();
    if (!entry.consultationStartTime) entry.consultationStartTime = new Date();
    await entry.save();

    if (entry.appointment) {
      await Appointment.findByIdAndUpdate(entry.appointment, { status: 'completed' });
    }

    // Complete the Consultation record
    const consultation = await Consultation.findOne({ queueEntry: entry._id });
    if (consultation) {
      await consultation.complete(req.body.notes || null);
      // Update session rolling average
      const session = await DoctorQueueSession.findOne({ doctor: entry.doctor, queueDate: entry.queueDate });
      if (session && consultation.durationMinutes) {
        await session.recordConsultation(consultation.durationMinutes);
      }
    }

    // Clear session current entry
    await DoctorQueueSession.findOneAndUpdate(
      { doctor: entry.doctor, queueDate: entry.queueDate },
      { currentQueueEntryId: null }
    );

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'CONSULTATION_COMPLETED',
      oldStatus: 'in_consultation',
      newStatus: 'completed',
      oldZone: 'CURRENT',
      newZone: 'COMPLETED',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate
    });

    await entry.populate([
      { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('queue:completed', { queueEntry: entry, room: entry.room });
      io.emit('queue:display:update', { room: entry.room, date: entry.queueDate });
    }

    await QueueEngine.recalculate(entry.doctor.toString(), entry.queueDate, io);

    res.json({ success: true, message: 'Consultation completed', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Complete consultation error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Skip patient (does not permanently close the entry)
// PATCH /api/queue/:id/skip
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/skip', auth, authorize('doctor', 'receptionist', 'staff', 'admin'), auditLog('QUEUE_SKIP', 'QueueEntry'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['waiting', 'ready', 'called', 'emergency_waiting'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot skip — current status is '${entry.status}'` });
    }
    if (req.user.role === 'doctor' && entry.doctor.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const oldStatus = entry.status;
    entry.status = 'skipped';
    entry.zone = 'WAITING_POOL';
    entry.isLocked = false;
    entry.skippedAt = new Date();
    await entry.save();

    if (entry.appointment) {
      await Appointment.findByIdAndUpdate(entry.appointment, { status: 'skipped' });
    }

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'SKIPPED',
      oldStatus,
      newStatus: 'skipped',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate,
      remarks: req.body.reason || null
    });

    await entry.populate([{ path: 'patient', select: 'firstName lastName phone' }, { path: 'doctor', select: 'firstName lastName' }]);

    const io = req.app.get('io');
    if (io) io.emit('queue:updated', { queueEntry: entry, room: entry.room });

    await QueueEngine.recalculate(entry.doctor.toString(), entry.queueDate, io);

    res.json({ success: true, message: 'Patient skipped', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Skip error:', error);
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

    if (!['waiting', 'ready', 'called', 'skipped'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot mark no-show — current status is '${entry.status}'` });
    }

    const noShowOldStatus = entry.status;
    entry.status = 'no_show';
    entry.zone = 'COMPLETED';
    entry.noShowAt = new Date();
    await entry.save();

    if (entry.appointment) {
      await Appointment.findByIdAndUpdate(entry.appointment, { status: 'no-show' });
    }

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'NO_SHOW',
      oldStatus: noShowOldStatus,
      newStatus: 'no_show',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate
    });

    await entry.populate([{ path: 'patient', select: 'firstName lastName phone' }, { path: 'doctor', select: 'firstName lastName' }]);

    const io = req.app.get('io');
    if (io) io.emit('queue:updated', { queueEntry: entry, room: entry.room });

    await QueueEngine.recalculate(entry.doctor.toString(), entry.queueDate, io);

    res.json({ success: true, message: 'Marked as no-show', data: { queueEntry: entry } });
  } catch (error) {
    console.error('No-show error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RECEPTIONIST / DOCTOR — Mark temporarily away (patient stepped out)
// PATCH /api/queue/:id/temporarily-away
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/temporarily-away', auth, authorize('doctor', 'receptionist', 'staff', 'admin'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['waiting', 'ready', 'called'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot mark temporarily away — current status is '${entry.status}'` });
    }

    const oldStatus = entry.status;
    entry.status = 'temporarily_away';
    entry.isLocked = false;
    entry.temporarilyAwayAt = new Date();
    await entry.save();

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'TEMPORARILY_AWAY',
      oldStatus,
      newStatus: 'temporarily_away',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate
    });

    await entry.populate([{ path: 'patient', select: 'firstName lastName phone' }, { path: 'doctor', select: 'firstName lastName' }]);

    const io = req.app.get('io');
    if (io) io.emit('queue:updated', { queueEntry: entry, room: entry.room });

    await QueueEngine.recalculate(entry.doctor.toString(), entry.queueDate, io);

    res.json({ success: true, message: 'Patient marked as temporarily away', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Temporarily away error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RECEPTIONIST / DOCTOR — Mark patient as returned
// PATCH /api/queue/:id/returned
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/returned', auth, authorize('doctor', 'receptionist', 'staff', 'admin'), async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

    if (!['temporarily_away', 'skipped'].includes(entry.status)) {
      return res.status(400).json({ success: false, message: `Cannot mark returned — current status is '${entry.status}'` });
    }

    const returnedOldStatus = entry.status;
    entry.status = 'waiting';
    entry.zone = 'WAITING_POOL';
    entry.isLocked = false;
    entry.returnedAt = new Date();
    // Penalize slightly so returned patient doesn't jump back to original spot
    entry.priorityScore = (entry.priorityScore || 100) + 50;
    entry.sortOrder = entry.priorityScore;
    await entry.save();

    await QueueEventLog.create({
      queueEntryId: entry._id,
      appointmentId: entry.appointment,
      doctorId: entry.doctor,
      patientId: entry.patient,
      eventType: 'RETURNED',
      oldStatus: returnedOldStatus,
      newStatus: 'waiting',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate: entry.queueDate,
      remarks: 'Patient returned to queue'
    });

    await entry.populate([{ path: 'patient', select: 'firstName lastName phone' }, { path: 'doctor', select: 'firstName lastName' }]);

    const io = req.app.get('io');
    if (io) io.emit('queue:updated', { queueEntry: entry, room: entry.room });

    await QueueEngine.recalculate(entry.doctor.toString(), entry.queueDate, io);

    res.json({ success: true, message: 'Patient returned to queue', data: { queueEntry: entry } });
  } catch (error) {
    console.error('Returned error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Pause queue session
// PATCH /api/queue/session/:doctorId/pause
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/session/:doctorId/pause', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { doctorId } = req.params;
    if (req.user.role === 'doctor' && req.user.id !== doctorId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const queueDate = localDateStr();
    const session = await DoctorQueueSession.findOneAndUpdate(
      { doctor: doctorId, queueDate },
      { status: 'paused', pausedAt: new Date(), delayMessage: req.body.message || 'Queue temporarily paused by doctor.' },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'No active queue session found' });
    }

    await QueueEventLog.create({
      queueEntryId: null,
      doctorId,
      eventType: 'QUEUE_PAUSED',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate,
      remarks: req.body.message || 'Queue paused'
    });

    const io = req.app.get('io');
    if (io) io.emit('queue:paused', { doctorId, queueDate, message: session.delayMessage });

    res.json({ success: true, message: 'Queue paused', data: { session } });
  } catch (error) {
    console.error('Pause queue error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR — Resume queue session
// PATCH /api/queue/session/:doctorId/resume
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/session/:doctorId/resume', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { doctorId } = req.params;
    if (req.user.role === 'doctor' && req.user.id !== doctorId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const queueDate = localDateStr();
    const session = await DoctorQueueSession.findOneAndUpdate(
      { doctor: doctorId, queueDate },
      { status: 'active', resumedAt: new Date(), delayMessage: null },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'No queue session found' });
    }

    await QueueEventLog.create({
      queueEntryId: null,
      doctorId,
      eventType: 'QUEUE_RESUMED',
      performedBy: req.user.id,
      performedByRole: req.user.role,
      queueDate,
      remarks: 'Queue resumed'
    });

    const io = req.app.get('io');
    if (io) io.emit('queue:resumed', { doctorId, queueDate });
    await QueueEngine.recalculate(doctorId, queueDate, io);

    res.json({ success: true, message: 'Queue resumed', data: { session } });
  } catch (error) {
    console.error('Resume queue error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
