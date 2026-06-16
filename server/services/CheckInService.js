const Appointment    = require('../models/Appointment');
const QueueEntry     = require('../models/QueueEntry');
const QueuePolicy    = require('../models/QueuePolicy');
const QueueEventLog  = require('../models/QueueEventLog');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const TimeBlock      = require('../models/TimeBlock');
const User           = require('../models/User');
const { localDateStr }                              = require('./TokenGenerator');
const { nextWalkInToken, nextEmergencyToken, buildScope } = require('./TokenSequenceService');

/**
 * CheckInService — authoritative entry point for all patient check-ins.
 *
 * Handles two appointment flows:
 *
 *   NEW FLOW (block-based booking, appointmentToken already set at booking):
 *     - Appointment was created via General OPD or block-based specialist booking
 *     - appointment.appointmentToken = 'A014' (issued at booking)
 *     - Check-in ACTIVATES the token — creates QueueEntry with the existing token
 *     - Doctor is assigned at check-in by reception
 *     - Does NOT generate a new token
 *
 *   LEGACY FLOW (exact-time booking, no appointmentToken):
 *     - Appointment was created with appointmentTime and a specific doctor
 *     - Check-in GENERATES the A token at this point (existing behaviour)
 *
 * Walk-in flow: W token issued from shared A/W sequence via TokenSequenceService
 * Emergency flow: E token from separate emergency sequence via TokenSequenceService
 */

// ── Statuses ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES       = ['cancelled', 'completed', 'no-show', 'rescheduled', 'doctor-unavailable'];
const ALREADY_ACTIVE_STATUSES = ['checked_in', 'in_queue', 'in_consultation', 'in-progress', 'skipped', 'late', 'delayed'];
const CHECKABLE_STATUSES      = ['booked', 'scheduled', 'confirmed'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse HH:MM into total minutes from midnight.
 */
const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Resolve the reference appointment datetime for check-in window checking.
 * For block-based appointments, use the time block's startTime.
 * For exact-time appointments, use appointmentTime.
 *
 * @returns {Date|null} the reference datetime, or null if indeterminate
 */
const resolveAppointmentDateTime = async (appointment) => {
  const baseDate = new Date(appointment.appointmentDate);
  baseDate.setHours(0, 0, 0, 0);

  // New flow: time block
  if (appointment.timeBlockId) {
    const block = await TimeBlock.findById(appointment.timeBlockId).lean();
    if (block) {
      const mins = toMinutes(block.startTime);
      if (mins !== null) {
        const dt = new Date(baseDate);
        dt.setMinutes(dt.getMinutes() + mins);
        return dt;
      }
    }
  }

  // Legacy flow: exact appointmentTime
  if (appointment.appointmentTime) {
    const mins = toMinutes(appointment.appointmentTime);
    if (mins !== null) {
      const dt = new Date(baseDate);
      dt.setMinutes(dt.getMinutes() + mins);
      return dt;
    }
  }

  return null;
};

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Check whether a patient is eligible to check in for their appointment.
 *
 * Returns: { eligible, reason, arrivalStatus, minutesUntilAppointment, appointment, policy }
 * arrivalStatus: 'early' | 'on_time' | 'late' | 'too_early'
 */
const getAppointmentEligibility = async (appointmentId, patientId) => {
  const appointment = await Appointment.findById(appointmentId)
    .populate('doctor', 'firstName lastName specialization department')
    .populate('departmentId', 'name code')
    .populate('timeBlockId', 'startTime endTime sessionName reportingTime');

  if (!appointment) return { eligible: false, reason: 'Appointment not found' };

  if (appointment.patient.toString() !== patientId.toString()) {
    return { eligible: false, reason: 'Appointment does not belong to this patient' };
  }

  if (TERMINAL_STATUSES.includes(appointment.status)) {
    return { eligible: false, reason: `Appointment is ${appointment.status} and cannot be checked in.` };
  }

  if (ALREADY_ACTIVE_STATUSES.includes(appointment.status)) {
    return { eligible: false, reason: 'You are already checked in for this appointment.', alreadyCheckedIn: true };
  }

  if (!CHECKABLE_STATUSES.includes(appointment.status)) {
    return { eligible: false, reason: `Appointment status '${appointment.status}' does not allow check-in.` };
  }

  // Check if a QueueEntry already exists for this appointment
  const existingEntry = await QueueEntry.findOne({
    appointment: appointmentId,
    status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  if (existingEntry) {
    return { eligible: false, reason: 'Patient is already in the queue', alreadyCheckedIn: true, existingEntry };
  }

  // Resolve policy — for General OPD use departmentId, for specialist use doctorId
  const policyDoctorId = appointment.doctor?._id || null;
  const policyDeptId   = appointment.departmentId?._id?.toString()
                       || appointment.departmentId?.toString()
                       || null;
  const policy = await QueuePolicy.resolveFor(policyDoctorId, policyDeptId);

  // Resolve the reference datetime for the check-in window
  const apptDateTime = await resolveAppointmentDateTime(appointment);

  // If we can't determine datetime (very old legacy record), allow check-in
  if (!apptDateTime) {
    return { eligible: true, reason: '', arrivalStatus: 'on_time', minutesUntilAppointment: 0, appointment, policy };
  }

  const now = new Date();
  const minutesUntilAppointment = Math.round((apptDateTime - now) / 60000);

  let arrivalStatus = 'on_time';
  let eligible = true;
  let reason = '';

  if (minutesUntilAppointment > policy.earlyCheckInMinutes) {
    eligible = false;
    arrivalStatus = 'too_early';
    const openTime = new Date(apptDateTime.getTime() - policy.earlyCheckInMinutes * 60000);
    reason = `Check-in opens ${policy.earlyCheckInMinutes} minutes before your appointment. Please return at ${openTime.toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' })}.`;
  } else if (minutesUntilAppointment >= -policy.gracePeriodMinutes) {
    arrivalStatus = minutesUntilAppointment >= 0 ? 'early' : 'on_time';
  } else {
    arrivalStatus = 'late';
    reason = `You are ${Math.abs(minutesUntilAppointment)} minutes late. Your position in the queue will be adjusted.`;
  }

  return { eligible, reason, arrivalStatus, minutesUntilAppointment, appointment, policy };
};

// ── Appointment Check-in ──────────────────────────────────────────────────────

/**
 * Check in a booked appointment patient.
 *
 * Dual-mode:
 *   NEW FLOW  — appointment.appointmentToken is set → activate existing token
 *   LEGACY    — no appointmentToken → generate A token (old behaviour)
 *
 * @param {object} opts
 * @param {string} opts.appointmentId
 * @param {string} opts.patientId
 * @param {string} opts.performedById
 * @param {string} opts.performedByRole
 * @param {string} opts.room
 * @param {string} opts.department        string name (for QueueEntry)
 * @param {string} opts.doctorId          required — reception assigns doctor at check-in
 * @param {string} [opts.departmentId]    ObjectId string (for new-flow QueueEntry scope)
 * @param {string} [opts.timeBlockId]     ObjectId string (for new-flow QueueEntry scope)
 * @param {string} [opts.notes]
 * @param {'normal'|'urgent'} [opts.priority]
 */
const checkInAppointment = async ({
  appointmentId,
  patientId,
  performedById,
  performedByRole,
  room,
  department,
  doctorId,
  departmentId,
  timeBlockId,
  notes,
  priority = 'normal'
}) => {
  const eligibility = await getAppointmentEligibility(appointmentId, patientId);

  if (!eligibility.eligible) {
    const err = new Error(eligibility.reason);
    err.statusCode = eligibility.alreadyCheckedIn ? 409 : 400;
    err.data = eligibility.alreadyCheckedIn ? { existingEntry: eligibility.existingEntry } : undefined;
    throw err;
  }

  const { appointment, policy, arrivalStatus } = eligibility;
  const queueDate = localDateStr();
  const isLate    = arrivalStatus === 'late';

  // ETA from session or policy
  const session   = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate });
  const avgMins   = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
  const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate, avgMins);

  // ── Priority score ────────────────────────────────────────────────────────────
  // Base score: urgent patients jump ahead; late patients go after normal
  let priorityScore = priority === 'urgent' ? 20 : 100;
  if (isLate) {
    // Score used for legacy 'end_of_pool'/'penalty_offset' rules
    // For 'next_after_current' the QueueEngine handles insertion position
    if (policy.lateArrivalRule === 'end_of_pool') {
      priorityScore = 200;
    } else if (policy.lateArrivalRule === 'penalty_offset') {
      priorityScore = 100 + policy.latePenaltyPositions * 10;
    }
  }
  // Sub-sort within same score: tiebreak by scheduled appointment time
  const apptTimeMins = toMinutes(appointment.appointmentTime);
  if (apptTimeMins !== null) priorityScore += apptTimeMins / 10000;

  // ── Resolve token ─────────────────────────────────────────────────────────────
  let queueNumber, sequenceNumber, tokenType;

  const isNewFlow = !!appointment.appointmentToken;

  if (isNewFlow) {
    // NEW FLOW: token was issued at booking — just activate it
    queueNumber    = appointment.appointmentToken;
    sequenceNumber = appointment.tokenNumber;
    tokenType      = appointment.tokenPrefix || 'A';
  } else {
    // LEGACY FLOW: generate A token now
    // (kept for backward compatibility with old scheduled/confirmed appointments)
    const { generateToken } = require('./TokenGenerator');
    tokenType = 'A';
    const MAX_TOKEN_RETRIES = 5;
    let tokenResult;
    for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
      tokenResult = await generateToken(doctorId, queueDate, tokenType);
      try {
        // Test if this token is available (create will fail with 11000 if duplicate)
        queueNumber    = tokenResult.queueNumber;
        sequenceNumber = tokenResult.sequenceNumber;
        break;
      } catch {
        if (attempt === MAX_TOKEN_RETRIES - 1) throw new Error('Unable to generate a unique queue token.');
      }
    }
  }

  // ── Create QueueEntry ─────────────────────────────────────────────────────────
  const MAX_RETRIES = isNewFlow ? 1 : 5; // new flow: token is fixed, no retry needed
  let queueEntry;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (!isNewFlow && attempt > 0) {
      // Retry with next token for legacy flow
      const { generateToken } = require('./TokenGenerator');
      const t = await generateToken(doctorId, queueDate, tokenType);
      queueNumber    = t.queueNumber;
      sequenceNumber = t.sequenceNumber;
    }

    try {
      queueEntry = await QueueEntry.create({
        patient:              patientId,
        doctor:               doctorId,
        appointment:          appointmentId,
        checkedInBy:          performedById,
        room,
        department,
        // New-flow scope fields
        departmentId:         departmentId || appointment.departmentId || null,
        timeBlockId:          timeBlockId  || appointment.timeBlockId  || null,
        // Token
        queueNumber,
        sequenceNumber,
        tokenType,
        appointmentToken:     appointment.appointmentToken || null,
        originalTokenNumber:  appointment.tokenNumber      || sequenceNumber,
        // Priority
        priority,
        priorityScore,
        // Flags
        isWalkIn:    false,
        isEmergency: false,
        isLate,
        // Context
        appointmentTime: appointment.appointmentTime || null,
        notes,
        estimatedWaitMinutes,
        checkInTime: new Date(),
        queueDate,
        status:    'waiting',
        zone:      'WAITING_POOL',
        sortOrder: priorityScore
      });
      break; // success
    } catch (err) {
      if (err.code === 11000) {
        if (err.message?.includes('appointment')) {
          const conflict = new Error('You are already checked in for this appointment.');
          conflict.statusCode = 409;
          throw conflict;
        }
        if (isNewFlow || attempt === MAX_RETRIES - 1) {
          throw new Error('Unable to create queue entry. Please try again.');
        }
        continue; // legacy flow: retry with next token
      }
      throw err;
    }
  }

  // ── Update Appointment ────────────────────────────────────────────────────────
  appointment.status = 'in_queue';
  appointment.checkIn = { time: new Date(), method: 'manual', verifiedBy: performedById };
  // If doctor was assigned at check-in (General OPD), persist it back
  if (!appointment.doctor && doctorId) {
    appointment.doctor = doctorId;
  }
  await appointment.save();

  // ── Session + Event log ───────────────────────────────────────────────────────
  await DoctorQueueSession.getOrCreate(doctorId, department, queueDate, room);

  await QueueEventLog.create({
    queueEntryId:    queueEntry._id,
    appointmentId,
    doctorId,
    patientId,
    eventType:       'CHECKED_IN',
    newStatus:       'waiting',
    newZone:         'WAITING_POOL',
    performedBy:     performedById,
    performedByRole,
    queueDate,
    remarks: `${isNewFlow ? 'Token activated' : 'Token generated'} at check-in. Arrival: ${arrivalStatus}. Token: ${queueEntry.queueNumber}. ${isLate ? '[LATE ARRIVAL]' : ''}`
  });

  await queueEntry.populate([
    { path: 'patient',    select: 'firstName lastName phone digitalHealthCardId' },
    { path: 'doctor',     select: 'firstName lastName specialization' },
    { path: 'checkedInBy', select: 'firstName lastName' }
  ]);

  return { queueEntry, appointment, token: queueEntry.queueNumber, arrivalStatus, estimatedWaitMinutes, policy };
};

// ── Walk-in Check-in ──────────────────────────────────────────────────────────

/**
 * Check in a walk-in patient (no prior appointment).
 *
 * W tokens use the shared A/W numeric sequence via TokenSequenceService.
 * E tokens use the separate emergency sequence.
 *
 * @param {object} opts
 * @param {string} opts.patientId
 * @param {string} opts.performedById
 * @param {string} opts.performedByRole
 * @param {string} opts.room
 * @param {string} opts.department          string name
 * @param {string} [opts.departmentId]      ObjectId — preferred for token scope
 * @param {string} opts.doctorId
 * @param {string} [opts.notes]
 * @param {boolean} [opts.isEmergency]
 * @param {'normal'|'urgent'} [opts.priority]
 */
const checkInWalkIn = async ({
  patientId,
  performedById,
  performedByRole,
  room,
  department,
  departmentId,
  doctorId,
  notes,
  isEmergency = false,
  priority    = 'normal'
}) => {
  // Validate patient
  const patient = await User.findById(patientId);
  if (!patient || patient.role !== 'patient') {
    const err = new Error('Patient not found');
    err.statusCode = 404;
    throw err;
  }

  // Validate doctor
  const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true });
  if (!doctor) {
    const err = new Error('Doctor not found');
    err.statusCode = 404;
    throw err;
  }

  const queueDate = localDateStr();

  // Prevent duplicate active walk-in for same patient+doctor today
  const existing = await QueueEntry.findOne({
    patient: patientId,
    doctor:  doctorId,
    queueDate,
    status:  { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  if (existing) {
    const err = new Error('Patient already has an active queue entry with this doctor today');
    err.statusCode = 409;
    err.data = { existingEntry: existing };
    throw err;
  }

  const policy = await QueuePolicy.resolveFor(doctorId, departmentId || department);
  const session = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate });
  const avgMins = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
  const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate, avgMins);

  // ── Build token scope ─────────────────────────────────────────────────────────
  // Walk-ins and appointments share the same NORMAL sequence per dept/date
  const tokenScopeStr = policy.tokenScope || 'dept_date_session';
  const scope = buildScope({
    departmentId: departmentId || null,
    doctorId:     tokenScopeStr === 'doctor_date' ? doctorId : null,
    date:         queueDate,
    timeBlockId:  null,
    tokenScope:   departmentId ? tokenScopeStr : 'doctor_date'
  });

  // ── Generate token ────────────────────────────────────────────────────────────
  let tokenResult;
  let tokenType;

  if (isEmergency) {
    tokenType   = 'E';
    tokenResult = await nextEmergencyToken({
      departmentId: departmentId || null,
      date:         queueDate
    });
  } else {
    tokenType   = 'W';
    tokenResult = await nextWalkInToken(scope);
  }

  const { queueNumber, sequenceNumber } = tokenResult;

  // ── Priority score ────────────────────────────────────────────────────────────
  let priorityScore = isEmergency ? 10 : (priority === 'urgent' ? 50 : 300);
  priorityScore += Date.now() / 1e13; // tiny tiebreak by check-in time

  // ── Create QueueEntry ─────────────────────────────────────────────────────────
  const queueEntry = await QueueEntry.create({
    patient:      patientId,
    doctor:       doctorId,
    appointment:  null,
    checkedInBy:  performedById,
    room,
    department,
    departmentId: departmentId || null,
    // Token
    queueNumber,
    sequenceNumber,
    tokenType,
    appointmentToken:    null,
    originalTokenNumber: sequenceNumber,
    // Priority
    priority,
    priorityScore,
    // Flags
    isWalkIn:    !isEmergency,
    isEmergency,
    isLate:      false,
    notes,
    estimatedWaitMinutes,
    checkInTime: new Date(),
    queueDate,
    status:      isEmergency ? 'emergency_waiting' : 'waiting',
    zone:        'WAITING_POOL',
    sortOrder:   priorityScore
  });

  // ── Session + Event log ───────────────────────────────────────────────────────
  await DoctorQueueSession.getOrCreate(doctorId, department, queueDate, room);

  await QueueEventLog.create({
    queueEntryId: queueEntry._id,
    appointmentId: null,
    doctorId,
    patientId,
    eventType:   isEmergency ? 'EMERGENCY_INSERTED' : 'CHECKED_IN',
    newStatus:   queueEntry.status,
    newZone:     'WAITING_POOL',
    performedBy: performedById,
    performedByRole,
    queueDate,
    remarks: `Walk-in check-in${isEmergency ? ' (EMERGENCY)' : ''}. Token: ${queueEntry.queueNumber}`
  });

  await queueEntry.populate([
    { path: 'patient',    select: 'firstName lastName phone digitalHealthCardId' },
    { path: 'doctor',     select: 'firstName lastName specialization' },
    { path: 'checkedInBy', select: 'firstName lastName' }
  ]);

  return { queueEntry, token: queueEntry.queueNumber, estimatedWaitMinutes, policy };
};

module.exports = { getAppointmentEligibility, checkInAppointment, checkInWalkIn };
