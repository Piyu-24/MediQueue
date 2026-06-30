const express    = require('express');
const { body, query: qv, param, validationResult } = require('express-validator');
const QRCode     = require('qrcode');
const bcrypt     = require('bcryptjs');
const User       = require('../models/User');
const AuditLog   = require('../models/AuditLog');
const Appointment = require('../models/Appointment');
const QueueEntry = require('../models/QueueEntry');
const QueueEventLog = require('../models/QueueEventLog');
const HealthCard = require('../models/HealthCard');
const Department = require('../models/Department');
const TimeBlock  = require('../models/TimeBlock');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const Room       = require('../models/Room');
const auth       = require('../middleware/auth');
const authorize  = require('../middleware/authorize');
const { checkInAppointment, checkInWalkIn } = require('../services/CheckInService');
const QueueEngine = require('../services/QueueEngine');
const { localDateStr } = require('../services/TokenGenerator');

const router = express.Router();

// All reception routes require auth + receptionist/staff/admin role
router.use(auth);
router.use(authorize('receptionist', 'staff', 'admin'));

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT SEARCH
// GET /api/reception/patients/search
//
// Search patients by NIC, phone, name, hospital (health card) number, or email.
// Returns patient profile + health card status + today's appointment if any.
//
// Query params:
//   q    — search term
//   by   — 'nic' | 'phone' | 'name' | 'card' | 'email' | 'all' (default 'all')
//   date — YYYY-MM-DD for appointment context (default: today)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/patients/search',
  [qv('q').notEmpty().withMessage('Search query is required')],
  handleValidation,
  async (req, res) => {
    try {
      const { q, by = 'all', date } = req.query;
      const term    = q.trim();
      const searchDate = date || localDateStr();

      // Build targeted or broad filter
      let filter = { role: 'patient', isActive: true };

      if (by === 'nic') {
        filter.nicNumber = { $regex: term, $options: 'i' };
      } else if (by === 'phone') {
        filter.$or = [
          { phone:        { $regex: term, $options: 'i' } },
          { phoneNumber:  { $regex: term, $options: 'i' } }
        ];
      } else if (by === 'name') {
        filter.$or = [
          { firstName: { $regex: term, $options: 'i' } },
          { lastName:  { $regex: term, $options: 'i' } },
          { $expr: { $regexMatch: { input: { $concat: ['$firstName', ' ', '$lastName'] }, regex: term, options: 'i' } } }
        ];
      } else if (by === 'card') {
        filter.digitalHealthCardId = { $regex: term, $options: 'i' };
      } else if (by === 'email') {
        filter.email = { $regex: term, $options: 'i' };
      } else {
        // 'all' — broad search across all identifiers
        filter.$or = [
          { firstName:          { $regex: term, $options: 'i' } },
          { lastName:           { $regex: term, $options: 'i' } },
          { email:              { $regex: term, $options: 'i' } },
          { phone:              { $regex: term, $options: 'i' } },
          { phoneNumber:        { $regex: term, $options: 'i' } },
          { nicNumber:          { $regex: term, $options: 'i' } },
          { digitalHealthCardId:{ $regex: term, $options: 'i' } }
        ];
      }

      const patients = await User.find(filter)
        .select('firstName lastName email phone phoneNumber nicNumber dateOfBirth gender digitalHealthCardId hasSmartphone bloodType allergies chronicConditions emergencyContact')
        .limit(20)
        .lean();

      if (patients.length === 0) {
        return res.json({ success: true, data: [], count: 0, message: 'No patients found' });
      }

      // Enrich each patient with health card status and today's appointments
      const patientIds = patients.map(p => p._id);

      const [healthCards, todaysAppointments, activeQueueEntries] = await Promise.all([
        HealthCard.find({ patient: { $in: patientIds } })
          .select('patient cardNumber status expiryDate issueDate qrCode')
          .lean(),
        Appointment.find({
          patient: { $in: patientIds },
          appointmentDate: {
            $gte: new Date(searchDate),
            $lt:  new Date(new Date(searchDate).getTime() + 86400000)
          },
          status: { $nin: ['cancelled', 'rescheduled'] }
        })
          .populate('doctor', 'firstName lastName specialization')
          .populate('timeBlockId', 'startTime endTime sessionName')
          .select('patient doctor status appointmentToken timeBlockId appointmentTime appointmentDate bookingType reportingTime appointmentReference departmentId')
          .lean(),
        QueueEntry.find({
          patient: { $in: patientIds },
          queueDate: localDateStr(),
          status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
        })
          .select('patient queueNumber zone status estimatedWaitMinutes sortOrder doctor')
          .lean()
      ]);

      const hcByPatient  = Object.fromEntries(healthCards.map(hc => [hc.patient.toString(), hc]));
      const apptsByPatient = {};
      for (const a of todaysAppointments) {
        const pid = a.patient.toString();
        if (!apptsByPatient[pid]) apptsByPatient[pid] = [];
        apptsByPatient[pid].push(a);
      }
      const queueByPatient = {};
      for (const qe of activeQueueEntries) {
        const pid = qe.patient.toString();
        if (!queueByPatient[pid]) queueByPatient[pid] = [];
        queueByPatient[pid].push(qe);
      }

      const enriched = patients.map(p => {
        const pid = p._id.toString();
        const hc  = hcByPatient[pid];
        return {
          ...p,
          healthCard: hc
            ? { cardNumber: hc.cardNumber, status: hc.status, expiryDate: hc.expiryDate, hasCard: true }
            : { hasCard: false },
          todaysAppointments: apptsByPatient[pid] || [],
          activeQueueEntries: queueByPatient[pid] || []
        };
      });

      res.json({ success: true, data: enriched, count: enriched.length });
    } catch (err) {
      console.error('Reception patient search error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// QUICK PATIENT REGISTRATION
// POST /api/reception/patients
//
// Reception registers a new patient who doesn't have an account.
// Creates User + HealthCard + generates QR code automatically.
// Email verification skipped (staff-verified registration).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/patients',
  [
    body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }),
    body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }),
    body('phone').notEmpty().withMessage('Phone number is required'),
    body('nicNumber').optional().trim(),
    body('dateOfBirth').optional().isISO8601().withMessage('Invalid date of birth'),
    body('gender').optional().isIn(['male', 'female', 'other', 'prefer-not-to-say']),
    body('bloodType').optional().isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email address').normalizeEmail(),
    body('hasSmartphone').optional().isBoolean(),
    body('nicSeenAndVerified').optional().isBoolean()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const {
        firstName, lastName, phone, email, nicNumber, dateOfBirth,
        gender, bloodType, hasSmartphone = false,
        emergencyContact, address,
        nicSeenAndVerified = false
      } = req.body;

      // NIC is mandatory when receptionist marks it as seen
      if (nicSeenAndVerified && !nicNumber?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'NIC number is required when marking NIC as seen and verified.'
        });
      }

      // Check for NIC duplicate
      if (nicNumber) {
        const dupNIC = await User.findOne({ nicNumber: nicNumber.trim() });
        if (dupNIC) {
          return res.status(409).json({
            success: false,
            message: 'A patient with this NIC number already exists.',
            data: { existingPatientId: dupNIC._id }
          });
        }
      }

      // Check for phone duplicate
      const dupPhone = await User.findOne({
        $or: [{ phone: phone.trim() }, { phoneNumber: phone.trim() }],
        role: 'patient'
      });
      if (dupPhone) {
        return res.status(409).json({
          success: false,
          message: 'A patient with this phone number already exists.',
          data: { existingPatientId: dupPhone._id }
        });
      }

      // If reception didn't capture an email, generate a placeholder so the
      // unique email index is satisfied; the patient can update it later.
      const resolvedEmail = email?.trim()
        || `reception.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@mediqueue.lk`;

      if (email?.trim()) {
        const dupEmail = await User.findOne({ email: resolvedEmail });
        if (dupEmail) {
          return res.status(409).json({
            success: false,
            message: 'A patient with this email address already exists.',
            data: { existingPatientId: dupEmail._id }
          });
        }
      }

      const tempPassword = await bcrypt.hash(Math.random().toString(36), 10);

      // Determine verification fields based on whether receptionist confirmed NIC
      const now = new Date();
      const verificationFields = nicSeenAndVerified && nicNumber?.trim()
        ? {
            identityVerificationStatus: 'verified',
            verifiedBy:        req.user.id,
            verifiedAt:        now,
            verificationMethod: 'NIC_SEEN',
          }
        : { identityVerificationStatus: 'pending' };

      const patient = await User.create({
        firstName:   firstName.trim(),
        lastName:    lastName.trim(),
        email:       resolvedEmail,
        password:    tempPassword,
        phone:       phone.trim(),
        phoneNumber: phone.trim(),
        nicNumber:   nicNumber?.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender:      gender || undefined,
        bloodType:   bloodType || undefined,
        hasSmartphone,
        emergencyContact: emergencyContact || undefined,
        address:     address || undefined,
        role:        'patient',
        isActive:    true,
        isEmailVerified: true,
        registeredBy: 'Receptionist',
        ...verificationFields,
      });

      // Auto-generate health card
      const cardNumber = await HealthCard.generateCardNumber();
      const qrData = {
        cardNumber,
        patientId: patient._id.toString(),
        name: `${patient.firstName} ${patient.lastName}`,
        phone: patient.phone
      };
      const qrCode = await QRCode.toDataURL(JSON.stringify(qrData));
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 5);

      const healthCard = await HealthCard.create({
        patient:   patient._id,
        cardNumber,
        qrCode,
        expiryDate,
        bloodGroup: bloodType || undefined,
        emergencyContact: emergencyContact
          ? { name: emergencyContact.name, relation: emergencyContact.relationship, phone: emergencyContact.phone }
          : undefined
      });

      await User.findByIdAndUpdate(patient._id, { digitalHealthCardId: cardNumber });
      patient.digitalHealthCardId = cardNumber;

      // Audit log for patient registration by receptionist
      try {
        await AuditLog.createLog({
          userId:       req.user.id,
          userRole:     req.user.role,
          action:       'PATIENT_REGISTERED_BY_RECEPTION',
          resourceType: 'User',
          resourceId:   patient._id,
          ipAddress:    req.ip || 'unknown',
          userAgent:    req.headers['user-agent'] || 'unknown',
          status:       'SUCCESS',
          description:  `Receptionist registered patient ${patient.firstName} ${patient.lastName} (${cardNumber})${nicSeenAndVerified ? ' — NIC seen and verified' : ''}`,
          metadata: {
            patientId:          patient._id.toString(),
            cardNumber,
            registeredBy:       'Receptionist',
            nicSeenAndVerified: !!nicSeenAndVerified,
            verificationMethod: nicSeenAndVerified ? 'NIC_SEEN' : null,
          },
        });
      } catch (auditErr) {
        console.error('Audit log write failed:', auditErr.message);
      }

      res.status(201).json({
        success: true,
        message: `Patient registered. Health card ${cardNumber} issued.${nicSeenAndVerified ? ' Identity verified.' : ''}`,
        data: {
          patient: {
            _id:                patient._id,
            firstName:          patient.firstName,
            lastName:           patient.lastName,
            phone:              patient.phone,
            nicNumber:          patient.nicNumber,
            digitalHealthCardId: cardNumber,
            hasSmartphone,
            identityVerificationStatus: patient.identityVerificationStatus,
          },
          healthCard: {
            cardNumber: healthCard.cardNumber,
            qrCode:     healthCard.qrCode,
            expiryDate: healthCard.expiryDate,
            status:     healthCard.status
          }
        }
      });
    } catch (err) {
      console.error('Reception quick register error:', err);
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'Duplicate entry — patient may already exist.' });
      }
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// APPOINTMENT SEARCH (for check-in lookup)
// GET /api/reception/appointments/search
//
// Search today's appointments by token, reference, patient name or phone.
// Used by reception to find and verify an appointment before check-in.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/appointments/search', async (req, res) => {
  try {
    const { token, reference, name, phone, date } = req.query;

    if (!token && !reference && !name && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one: token, reference, name, or phone'
      });
    }

    const searchDate = date || localDateStr();
    const startOfDay = new Date(searchDate);
    const endOfDay   = new Date(new Date(searchDate).getTime() + 86400000);

    let filter = {
      appointmentDate: { $gte: startOfDay, $lt: endOfDay },
      status: { $nin: ['cancelled', 'rescheduled'] }
    };

    if (token)     filter.appointmentToken = token.toUpperCase();
    if (reference) filter.appointmentReference = reference.trim().toUpperCase();

    let appointments = await Appointment.find(filter)
      .populate('patient', 'firstName lastName phone email nicNumber digitalHealthCardId')
      .populate('doctor',  'firstName lastName specialization department')
      .populate('timeBlockId', 'startTime endTime sessionName')
      .populate('departmentId', 'name code')
      .sort({ appointmentDate: 1 })
      .limit(30)
      .lean();

    // Filter by populated patient name/phone (post-query)
    if (name) {
      const nameLower = name.toLowerCase();
      appointments = appointments.filter(a =>
        a.patient && `${a.patient.firstName} ${a.patient.lastName}`.toLowerCase().includes(nameLower)
      );
    }
    if (phone) {
      appointments = appointments.filter(a =>
        a.patient && (a.patient.phone || '').includes(phone.trim())
      );
    }

    res.json({ success: true, data: appointments, count: appointments.length });
  } catch (err) {
    console.error('Reception appointment search error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// APPOINTMENT CHECK-IN
// POST /api/reception/check-in/:appointmentId
//
// Delegates to CheckInService. Activates existing A token for new-flow appointments,
// generates A token for legacy appointments.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/check-in/:appointmentId',
  [
    param('appointmentId').isMongoId().withMessage('Invalid appointment ID'),
    body('doctorId').isMongoId().withMessage('Valid doctor ID required'),
    body('room').notEmpty().withMessage('Room is required'),
    body('department').notEmpty().withMessage('Department name is required'),
    body('departmentId').optional().isMongoId(),
    body('timeBlockId').optional().isMongoId(),
    body('roomId').optional().isMongoId()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { doctorId, room, department, departmentId, timeBlockId, roomId, notes, priority } = req.body;
      const { appointmentId } = req.params;

      // Fetch the appointment to get the patient ID
      const appointment = await Appointment.findById(appointmentId)
        .select('patient status appointmentToken bookingType departmentId timeBlockId');
      if (!appointment) {
        return res.status(404).json({ success: false, message: 'Appointment not found' });
      }

      // Resolve room string from roomId if provided (prefers explicit string from client)
      let resolvedRoom = room;
      if (roomId && !room) {
        const roomDoc = await Room.findById(roomId).select('roomNumber').lean();
        if (roomDoc) resolvedRoom = roomDoc.roomNumber;
      }

      const result = await checkInAppointment({
        appointmentId,
        patientId:       appointment.patient.toString(),
        performedById:   req.user.id,
        performedByRole: req.user.role,
        room:            resolvedRoom,
        department,
        doctorId,
        departmentId:   departmentId || appointment.departmentId?.toString(),
        timeBlockId:    timeBlockId  || appointment.timeBlockId?.toString(),
        notes,
        priority
      });

      // Persist room assignment on the appointment
      if (roomId) {
        await Appointment.findByIdAndUpdate(appointmentId, { $set: { assignedRoom: roomId } });
      }

      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, localDateStr(), io);

      const isNewFlow = !!appointment.appointmentToken;
      const patientMsg = result.arrivalStatus === 'late'
        ? `You checked in late. Token ${result.token} is still valid and will be called after the current consultation.`
        : `Token ${result.token} is now active. Please watch the display board.`;

      res.status(201).json({
        success: true,
        message: `Check-in successful. Token: ${result.token}${isNewFlow ? ' (activated)' : ' (assigned)'}.`,
        data: {
          queueEntry:           result.queueEntry,
          token:                result.token,
          arrivalStatus:        result.arrivalStatus,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          isNewFlow,
          patientMessage:       patientMsg
        }
      });
    } catch (err) {
      console.error('Reception check-in error:', err);
      res.status(err.statusCode || 500).json({ success: false, message: err.message, data: err.data });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// WALK-IN CHECK-IN
// POST /api/reception/walk-in
//
// Delegates to CheckInService. Issues W token from shared A/W sequence.
// Emergency flag issues E token from separate emergency sequence.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/walk-in',
  [
    body('patientId').isMongoId().withMessage('Valid patient ID required'),
    body('doctorId').isMongoId().withMessage('Valid doctor ID required'),
    body('room').notEmpty().withMessage('Room is required'),
    body('department').notEmpty().withMessage('Department name is required'),
    body('departmentId').optional().isMongoId(),
    body('isEmergency').optional().isBoolean(),
    body('roomId').optional().isMongoId()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { patientId, doctorId, room, department, departmentId, roomId, notes, isEmergency, priority } = req.body;

      // Resolve room string from roomId when explicit string not supplied
      let resolvedRoom = room;
      if (roomId && !room) {
        const roomDoc = await Room.findById(roomId).select('roomNumber').lean();
        if (roomDoc) resolvedRoom = roomDoc.roomNumber;
      }

      const result = await checkInWalkIn({
        patientId,
        performedById:   req.user.id,
        performedByRole: req.user.role,
        room:            resolvedRoom,
        department,
        departmentId,
        doctorId,
        notes,
        isEmergency: !!isEmergency,
        priority
      });

      const io = req.app.get('io');
      await QueueEngine.recalculate(doctorId, localDateStr(), io);

      res.status(201).json({
        success: true,
        message: isEmergency
          ? `Emergency patient added. Token: ${result.token}`
          : `Walk-in checked in. Token: ${result.token}`,
        data: {
          queueEntry:           result.queueEntry,
          token:                result.token,
          estimatedWaitMinutes: result.estimatedWaitMinutes,
          patientMessage: isEmergency
            ? `Emergency Token: ${result.token}. Patient placed at top of queue.`
            : `Your walk-in token is ${result.token}. Walk-in patients are called based on doctor availability, appointment load, and urgency. Please watch the display board.`
        }
      });
    } catch (err) {
      console.error('Reception walk-in error:', err);
      res.status(err.statusCode || 500).json({ success: false, message: err.message, data: err.data });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR ASSIGNMENT
// POST /api/reception/assign-doctor
//
// Assign or reassign a doctor to a QueueEntry. Used when reception needs to
// balance load or correct an assignment. Also updates the linked Appointment.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/assign-doctor',
  [
    body('queueEntryId').isMongoId().withMessage('Valid queueEntryId required'),
    body('doctorId').isMongoId().withMessage('Valid doctorId required'),
    body('reason').optional().trim().isLength({ max: 300 })
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { queueEntryId, doctorId, reason } = req.body;

      const [queueEntry, doctor] = await Promise.all([
        QueueEntry.findById(queueEntryId),
        User.findOne({ _id: doctorId, role: 'doctor', isActive: true }, 'firstName lastName specialization')
      ]);

      if (!queueEntry) return res.status(404).json({ success: false, message: 'Queue entry not found' });
      if (!doctor)     return res.status(404).json({ success: false, message: 'Doctor not found or inactive' });

      // Block reassignment if patient is currently being seen
      if (queueEntry.status === 'in_consultation') {
        return res.status(409).json({
          success: false,
          message: 'Cannot reassign doctor while patient is in consultation.'
        });
      }

      const oldDoctorId = queueEntry.doctor?.toString();
      queueEntry.doctor = doctorId;
      await queueEntry.save();

      // Update linked appointment's doctor if present
      if (queueEntry.appointment) {
        await Appointment.findByIdAndUpdate(
          queueEntry.appointment,
          { $set: { doctor: doctorId } }
        );
      }

      // Log the reassignment
      await QueueEventLog.create({
        queueEntryId,
        appointmentId: queueEntry.appointment || null,
        doctorId,
        patientId:     queueEntry.patient,
        eventType:     'DOCTOR_REASSIGNED',
        newStatus:     queueEntry.status,
        newZone:       queueEntry.zone,
        performedBy:   req.user.id,
        performedByRole: req.user.role,
        queueDate:     queueEntry.queueDate,
        remarks: `Doctor reassigned${reason ? ': ' + reason : ''}. Previous: ${oldDoctorId || 'none'}`
      });

      // Recalculate both old and new doctor queues
      const io = req.app.get('io');
      const queueDate = queueEntry.queueDate || localDateStr();
      await QueueEngine.recalculate(doctorId, queueDate, io);
      if (oldDoctorId && oldDoctorId !== doctorId) {
        await QueueEngine.recalculate(oldDoctorId, queueDate, io);
      }

      res.json({
        success: true,
        message: `Doctor assigned: ${doctor.firstName} ${doctor.lastName}`,
        data: { queueEntryId, doctor: { _id: doctor._id, firstName: doctor.firstName, lastName: doctor.lastName } }
      });
    } catch (err) {
      console.error('Assign doctor error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE STATUS OVERRIDES
// PATCH /api/reception/queue/:id/no-show
// PATCH /api/reception/queue/:id/temporarily-away
// PATCH /api/reception/queue/:id/returned
// PATCH /api/reception/queue/:id/late
// ─────────────────────────────────────────────────────────────────────────────

const queueStatusOp = (eventType, targetStatus, allowedFromStatuses, timestampField) =>
  async (req, res) => {
    try {
      const queueEntry = await QueueEntry.findById(req.params.id);
      if (!queueEntry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

      if (!allowedFromStatuses.includes(queueEntry.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot mark ${targetStatus} from status '${queueEntry.status}'.`
        });
      }

      const oldStatus = queueEntry.status;
      queueEntry.status = targetStatus;
      if (timestampField) queueEntry[timestampField] = new Date();
      if (targetStatus === 'no_show') {
        queueEntry.zone = 'COMPLETED';
        queueEntry.noShowAt = new Date();
      }
      await queueEntry.save();

      await QueueEventLog.create({
        queueEntryId: queueEntry._id,
        appointmentId: queueEntry.appointment || null,
        doctorId:      queueEntry.doctor,
        patientId:     queueEntry.patient,
        eventType,
        oldStatus,
        newStatus: targetStatus,
        performedBy:     req.user.id,
        performedByRole: req.user.role,
        queueDate:       queueEntry.queueDate,
        remarks: req.body.reason || ''
      });

      // Recalculate queue
      const io = req.app.get('io');
      await QueueEngine.recalculate(queueEntry.doctor.toString(), queueEntry.queueDate, io);

      // Also update linked appointment status for no-show
      if (targetStatus === 'no_show' && queueEntry.appointment) {
        await Appointment.findByIdAndUpdate(queueEntry.appointment, { status: 'no-show' });
      }

      res.json({
        success: true,
        message: `Patient marked as ${targetStatus}.`,
        data: { queueEntryId: queueEntry._id, status: targetStatus }
      });
    } catch (err) {
      console.error(`Queue status op (${targetStatus}) error:`, err);
      res.status(500).json({ success: false, message: err.message });
    }
  };

router.patch('/queue/:id/no-show',
  [param('id').isMongoId()], handleValidation,
  queueStatusOp('NO_SHOW', 'no_show', ['waiting', 'ready', 'called', 'emergency_waiting'], 'noShowAt')
);

router.patch('/queue/:id/temporarily-away',
  [param('id').isMongoId()], handleValidation,
  queueStatusOp('TEMPORARILY_AWAY', 'temporarily_away', ['waiting', 'ready', 'called'], 'temporarilyAwayAt')
);

router.patch('/queue/:id/returned',
  [param('id').isMongoId()], handleValidation,
  queueStatusOp('RETURNED', 'waiting', ['temporarily_away'], 'returnedAt')
);

// Mark a patient as late (sets isLate flag on existing QueueEntry; for cases
// where reception needs to manually flag a patient after they arrived past time).
router.patch('/queue/:id/late',
  [param('id').isMongoId()], handleValidation,
  async (req, res) => {
    try {
      const queueEntry = await QueueEntry.findById(req.params.id);
      if (!queueEntry) return res.status(404).json({ success: false, message: 'Queue entry not found' });

      if (!['waiting', 'ready'].includes(queueEntry.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot mark late from status '${queueEntry.status}'.`
        });
      }

      queueEntry.isLate = true;
      // Move out of READY zone so QueueEngine can reposition
      if (queueEntry.zone === 'READY') {
        queueEntry.zone     = 'WAITING_POOL';
        queueEntry.status   = 'waiting';
        queueEntry.isLocked = false;
      }
      await queueEntry.save();

      await QueueEventLog.create({
        queueEntryId:    queueEntry._id,
        appointmentId:   queueEntry.appointment || null,
        doctorId:        queueEntry.doctor,
        patientId:       queueEntry.patient,
        eventType:       'MARKED_LATE',
        newStatus:       queueEntry.status,
        newZone:         queueEntry.zone,
        performedBy:     req.user.id,
        performedByRole: req.user.role,
        queueDate:       queueEntry.queueDate,
        remarks:         req.body.reason || 'Manually marked late by reception'
      });

      const io = req.app.get('io');
      await QueueEngine.recalculate(queueEntry.doctor.toString(), queueEntry.queueDate, io);

      res.json({
        success: true,
        message: 'Patient marked as late arrival. Queue reordered.',
        data: { queueEntryId: queueEntry._id, isLate: true }
      });
    } catch (err) {
      console.error('Mark late error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CARD — GET OR GENERATE
// POST /api/reception/health-card/:patientId/generate
//
// Returns existing health card or creates one if missing.
// Returns the card data including QR code for display/printing.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/health-card/:patientId/generate',
  [param('patientId').isMongoId()], handleValidation,
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const patient = await User.findOne({ _id: patientId, role: 'patient' })
        .select('firstName lastName phone email dateOfBirth gender bloodType allergies nicNumber digitalHealthCardId');

      if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

      let healthCard = await HealthCard.findOne({ patient: patientId });

      if (!healthCard) {
        const cardNumber = await HealthCard.generateCardNumber();
        const qrData = {
          cardNumber,
          patientId,
          name: `${patient.firstName} ${patient.lastName}`,
          phone: patient.phone || ''
        };
        const qrCode   = await QRCode.toDataURL(JSON.stringify(qrData));
        const expiry   = new Date();
        expiry.setFullYear(expiry.getFullYear() + 5);

        healthCard = await HealthCard.create({
          patient: patientId,
          cardNumber,
          qrCode,
          expiryDate: expiry,
          bloodGroup: patient.bloodType || undefined,
          allergies: (patient.allergies || []).map(a => typeof a === 'string' ? a : a.allergen)
        });

        await User.findByIdAndUpdate(patientId, { digitalHealthCardId: cardNumber });
        patient.digitalHealthCardId = cardNumber;
      }

      await healthCard.logAccess(req.user.id, 'manual', req.ip, 'Reception health card generation');

      res.json({
        success: true,
        data: {
          healthCard,
          patient: {
            _id:       patient._id,
            firstName: patient.firstName,
            lastName:  patient.lastName,
            phone:     patient.phone,
            dateOfBirth: patient.dateOfBirth,
            gender:    patient.gender,
            bloodType: patient.bloodType,
            nicNumber: patient.nicNumber,
            digitalHealthCardId: patient.digitalHealthCardId || healthCard.cardNumber
          }
        }
      });
    } catch (err) {
      console.error('Health card generate error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CARD PRINT EVENT
// POST /api/reception/health-card/:patientId/print
//
// Records a print event and returns full card data for rendering.
// The actual printing is handled client-side using the returned data.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/health-card/:patientId/print',
  [param('patientId').isMongoId()], handleValidation,
  async (req, res) => {
    try {
      const { patientId } = req.params;

      const [patient, healthCard] = await Promise.all([
        User.findOne({ _id: patientId, role: 'patient' })
          .select('firstName lastName phone email dateOfBirth gender bloodType allergies nicNumber digitalHealthCardId address emergencyContact'),
        HealthCard.findOne({ patient: patientId })
      ]);

      if (!patient)    return res.status(404).json({ success: false, message: 'Patient not found' });
      if (!healthCard) return res.status(404).json({ success: false, message: 'No health card found — generate one first.' });

      // Log the print access
      await healthCard.logAccess(req.user.id, 'manual', req.ip, 'Health card printed by reception');

      res.json({
        success: true,
        message: 'Health card print data ready.',
        data: {
          printPayload: {
            cardNumber:     healthCard.cardNumber,
            qrCode:         healthCard.qrCode,
            issueDate:      healthCard.issueDate,
            expiryDate:     healthCard.expiryDate,
            status:         healthCard.status,
            bloodGroup:     healthCard.bloodGroup || patient.bloodType,
            patient: {
              _id:           patient._id,
              firstName:     patient.firstName,
              lastName:      patient.lastName,
              fullName:      `${patient.firstName} ${patient.lastName}`,
              dateOfBirth:   patient.dateOfBirth,
              gender:        patient.gender,
              phone:         patient.phone,
              nicNumber:     patient.nicNumber,
              address:       patient.address,
              emergencyContact: healthCard.emergencyContact || patient.emergencyContact
            },
            allergies:         healthCard.allergies,
            chronicConditions: healthCard.chronicConditions,
            hospital: {
              name: 'MediQueue Hospital',
              printedAt: new Date().toISOString(),
              printedBy: req.user.id
            }
          }
        }
      });
    } catch (err) {
      console.error('Health card print error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TODAY'S QUEUE OVERVIEW
// GET /api/reception/queue/today
//
// Unified view of today's activity for a department or specific doctor.
// Shows booked (not yet arrived), active queue, completed, and no-shows.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/queue/today', async (req, res) => {
  try {
    const { departmentId, doctorId, date } = req.query;

    if (!departmentId && !doctorId) {
      return res.status(400).json({ success: false, message: 'departmentId or doctorId is required' });
    }

    const queueDate  = date || localDateStr();
    const startOfDay = new Date(queueDate);
    const endOfDay   = new Date(new Date(queueDate).getTime() + 86400000);

    // Build appointment query
    const apptFilter = {
      appointmentDate: { $gte: startOfDay, $lt: endOfDay }
    };
    if (doctorId)     apptFilter.doctor     = doctorId;
    if (departmentId) apptFilter.departmentId = departmentId;

    // Build queue entry query
    const queueFilter = { queueDate };
    if (doctorId) queueFilter.doctor = doctorId;

    const [appointments, queueEntries, sessions] = await Promise.all([
      Appointment.find(apptFilter)
        .populate('patient', 'firstName lastName phone digitalHealthCardId nicNumber')
        .populate('doctor',  'firstName lastName specialization')
        .populate('timeBlockId', 'startTime endTime sessionName')
        .populate('departmentId', 'name code')
        .sort({ appointmentTime: 1 })
        .lean(),
      QueueEntry.find(queueFilter)
        .populate('patient', 'firstName lastName phone digitalHealthCardId')
        .populate('doctor',  'firstName lastName specialization')
        .sort({ sortOrder: 1 })
        .lean(),
      doctorId
        ? DoctorQueueSession.find({ doctor: doctorId, queueDate }).lean()
        : DoctorQueueSession.find({ queueDate }).lean()
    ]);

    // Partition appointments by status
    const bookedNotArrived = appointments.filter(a =>
      ['booked', 'scheduled', 'confirmed'].includes(a.status)
    );
    const checkedIn = appointments.filter(a =>
      ['in_queue', 'checked_in', 'in_consultation', 'in-progress', 'late', 'delayed'].includes(a.status)
    );
    const completed = appointments.filter(a => a.status === 'completed');
    const noShows   = appointments.filter(a => a.status === 'no-show');
    const cancelled = appointments.filter(a => a.status === 'cancelled');

    // Partition queue entries by zone
    const current   = queueEntries.filter(e => e.zone === 'CURRENT');
    const ready     = queueEntries.filter(e => e.zone === 'READY');
    const waiting   = queueEntries.filter(e => e.zone === 'WAITING_POOL' &&
                        ['waiting', 'emergency_waiting'].includes(e.status));
    const lateQueue = queueEntries.filter(e => e.isLate && e.zone !== 'COMPLETED');
    const walkIns   = queueEntries.filter(e => e.isWalkIn && e.zone !== 'COMPLETED');
    const emergencies = queueEntries.filter(e => e.isEmergency && e.zone !== 'COMPLETED');

    res.json({
      success: true,
      data: {
        date: queueDate,
        summary: {
          totalBooked:     bookedNotArrived.length,
          checkedIn:       checkedIn.length,
          activeInQueue:   current.length + ready.length + waiting.length,
          completed:       completed.length,
          noShows:         noShows.length,
          cancelled:       cancelled.length,
          walkIns:         walkIns.length,
          emergencies:     emergencies.length,
          lateArrivals:    lateQueue.length
        },
        appointments: { bookedNotArrived, checkedIn, completed, noShows, cancelled },
        queue:        { current, ready, waiting, lateQueue, walkIns, emergencies },
        sessions
      }
    });
  } catch (err) {
    console.error('Reception today queue error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR AVAILABILITY FOR ASSIGNMENT
// GET /api/reception/doctors/available
//
// Lists active doctors in a department with their current queue load.
// Used by reception when assigning/balancing doctors at check-in.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/doctors/available', async (req, res) => {
  try {
    const { departmentId, department, date } = req.query;

    if (!departmentId && !department) {
      return res.status(400).json({ success: false, message: 'departmentId or department name is required' });
    }

    const queueDate = date || localDateStr();
    const filter = { role: 'doctor', isActive: true };
    if (departmentId) {
      const dept = await Department.findById(departmentId).lean();
      if (dept) filter.department = { $regex: dept.name, $options: 'i' };
    } else {
      filter.department = { $regex: department, $options: 'i' };
    }

    const doctors = await User.find(filter)
      .select('firstName lastName specialization department')
      .lean();

    if (doctors.length === 0) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const doctorIds = doctors.map(d => d._id);

    const [queueCounts, sessions] = await Promise.all([
      QueueEntry.aggregate([
        {
          $match: {
            doctor:   { $in: doctorIds },
            queueDate,
            status:   { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
          }
        },
        { $group: { _id: '$doctor', count: { $sum: 1 } } }
      ]),
      DoctorQueueSession.find({ doctor: { $in: doctorIds }, queueDate }).lean()
    ]);

    const countMap   = Object.fromEntries(queueCounts.map(q => [q._id.toString(), q.count]));
    const sessionMap = Object.fromEntries(sessions.map(s => [s.doctor.toString(), s]));

    const enriched = doctors.map(d => {
      const did     = d._id.toString();
      const session = sessionMap[did];
      return {
        ...d,
        activePatientCount:      countMap[did] || 0,
        sessionStatus:           session?.status || 'not_started',
        avgConsultationMinutes:  session?.avgConsultationMinutes || 10,
        estimatedWaitForNext:    (countMap[did] || 0) * (session?.avgConsultationMinutes || 10)
      };
    });

    // Sort by least loaded doctor first
    enriched.sort((a, b) => a.activePatientCount - b.activePatientCount);

    res.json({ success: true, data: enriched, count: enriched.length });
  } catch (err) {
    console.error('Reception doctor availability error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
