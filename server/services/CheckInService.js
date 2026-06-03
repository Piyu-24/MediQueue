const Appointment = require('../models/Appointment');
const QueueEntry = require('../models/QueueEntry');
const QueuePolicy = require('../models/QueuePolicy');
const QueueEventLog = require('../models/QueueEventLog');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const User = require('../models/User');
const { generateToken, resolveTokenType, localDateStr } = require('./TokenGenerator');

/**
 * CheckInService — the authoritative entry point for all patient check-ins.
 *
 * Handles:
 *  - Appointment patient check-in (booked patients arriving at hospital)
 *  - Walk-in patient check-in (new or existing patients without appointment)
 *  - Emergency check-in (highest priority; bypasses normal ordering)
 *
 * In all cases, the service:
 *  1. Validates the check-in is allowed
 *  2. Enforces the check-in policy (early/on-time/late window)
 *  3. Generates the token (A/W/E prefix)
 *  4. Creates the QueueEntry
 *  5. Updates the Appointment status if linked
 *  6. Gets or creates the DoctorQueueSession
 *  7. Writes a QueueEventLog entry
 *  8. Returns all data needed for the response and for QueueEngine to recalculate
 */

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Check whether a patient is eligible to check in for their appointment.
 * Returns: { eligible, reason, arrivalStatus, minutesUntilAppointment }
 *
 * arrivalStatus: 'early' | 'on_time' | 'late'
 */
const getAppointmentEligibility = async (appointmentId, patientId) => {
  const appointment = await Appointment.findById(appointmentId)
    .populate('doctor', 'firstName lastName specialization department');

  if (!appointment) {
    return { eligible: false, reason: 'Appointment not found' };
  }

  if (appointment.patient.toString() !== patientId.toString()) {
    return { eligible: false, reason: 'Appointment does not belong to this patient' };
  }

  const TERMINAL_STATUSES = ['cancelled', 'completed', 'no-show', 'rescheduled', 'doctor-unavailable'];
  if (TERMINAL_STATUSES.includes(appointment.status)) {
    return { eligible: false, reason: `Appointment is ${appointment.status} and cannot be checked in.` };
  }

  const ALREADY_ACTIVE_STATUSES = ['checked_in', 'in_queue', 'in_consultation', 'in-progress', 'skipped', 'late', 'delayed'];
  if (ALREADY_ACTIVE_STATUSES.includes(appointment.status)) {
    return { eligible: false, reason: 'You are already checked in for this appointment.', alreadyCheckedIn: true };
  }

  // Check if an active QueueEntry already exists for this appointment
  const existingEntry = await QueueEntry.findOne({
    appointment: appointmentId,
    status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  if (existingEntry) {
    return { eligible: false, reason: 'Patient is already in the queue', alreadyCheckedIn: true, existingEntry };
  }

  // Resolve check-in policy
  const policy = await QueuePolicy.resolveFor(
    appointment.doctor._id,
    appointment.doctor.department
  );

  // Parse appointment datetime
  const [hours, minutes] = appointment.appointmentTime.split(':').map(Number);
  const apptDateTime = new Date(appointment.appointmentDate);
  apptDateTime.setHours(hours, minutes, 0, 0);

  const now = new Date();
  const minutesUntilAppointment = Math.round((apptDateTime - now) / 60000);

  let arrivalStatus = 'on_time';
  let eligible = true;
  let reason = '';

  if (minutesUntilAppointment > policy.earlyCheckInMinutes) {
    eligible = false;
    arrivalStatus = 'too_early';
    reason = `Check-in opens ${policy.earlyCheckInMinutes} minutes before your appointment. Please return at ${new Date(apptDateTime.getTime() - policy.earlyCheckInMinutes * 60000).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' })}.`;
  } else if (minutesUntilAppointment >= -policy.gracePeriodMinutes) {
    arrivalStatus = minutesUntilAppointment >= 0 ? 'early' : 'on_time';
    eligible = true;
  } else {
    arrivalStatus = 'late';
    eligible = true; // late patients can still check in but get a penalty
    reason = `You are ${Math.abs(minutesUntilAppointment)} minutes late. Your position in the queue will be adjusted.`;
  }

  return {
    eligible,
    reason,
    arrivalStatus,
    minutesUntilAppointment,
    appointment,
    policy
  };
};

// ── Appointment Check-in ──────────────────────────────────────────────────────

/**
 * Check in a booked appointment patient.
 *
 * @param {object} opts
 * @param {string} opts.appointmentId
 * @param {string} opts.patientId        MongoDB id of patient
 * @param {string} opts.performedById    MongoDB id of person performing check-in (receptionist or patient)
 * @param {string} opts.performedByRole
 * @param {string} opts.room
 * @param {string} opts.department
 * @param {string} opts.doctorId
 * @param {string} [opts.notes]
 * @param {'normal'|'urgent'} [opts.priority]
 * @returns {Promise<{ queueEntry, appointment, token, arrivalStatus, estimatedWaitMinutes }>}
 */
const checkInAppointment = async ({
  appointmentId,
  patientId,
  performedById,
  performedByRole,
  room,
  department,
  doctorId,
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
  const isLate = arrivalStatus === 'late';
  const tokenType = 'A';

  // Calculate ETA using session average if available
  const session = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate });
  const avgMins = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
  const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate, avgMins);

  // Determine initial priorityScore for sorting
  let priorityScore = priority === 'urgent' ? 20 : 100;
  if (isLate) {
    if (policy.lateArrivalRule === 'end_of_pool') {
      priorityScore = 200;
    } else if (policy.lateArrivalRule === 'penalty_offset') {
      priorityScore = 100 + policy.latePenaltyPositions * 10;
    }
  }
  const [apptH, apptM] = appointment.appointmentTime.split(':').map(Number);
  priorityScore += (apptH * 60 + apptM) / 10000;

  // Create QueueEntry with retry on duplicate token (race condition safety net).
  // The unique index on { doctor, queueDate, queueNumber } catches concurrent inserts
  // that both received the same candidate token before either committed.
  const MAX_TOKEN_RETRIES = 5;
  let queueEntry;
  for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
    const { queueNumber, sequenceNumber } = await generateToken(doctorId, queueDate, tokenType);
    try {
      queueEntry = await QueueEntry.create({
        patient: patientId,
        doctor: doctorId,
        appointment: appointmentId,
        checkedInBy: performedById,
        room,
        department,
        queueNumber,
        sequenceNumber,
        tokenType,
        priority,
        priorityScore,
        isWalkIn: false,
        isEmergency: false,
        isLate,
        appointmentTime: appointment.appointmentTime,
        notes,
        estimatedWaitMinutes,
        checkInTime: new Date(),
        queueDate,
        status: 'waiting',
        zone: 'WAITING_POOL',
        sortOrder: priorityScore
      });
      break; // success
    } catch (err) {
      // 11000 = duplicate key — token collision or duplicate appointment entry
      if (err.code === 11000) {
        // If it's the appointment uniqueness constraint, bubble as a user error
        if (err.message?.includes('appointment')) {
          const conflict = new Error('You are already checked in for this appointment.');
          conflict.statusCode = 409;
          throw conflict;
        }
        // Token collision — retry with the next available number
        if (attempt === MAX_TOKEN_RETRIES - 1) {
          throw new Error('Unable to generate a unique queue token. Please try again.');
        }
        continue;
      }
      throw err;
    }
  }

  // Update appointment status
  appointment.status = 'in_queue';
  appointment.checkIn = {
    time: new Date(),
    method: 'manual',
    verifiedBy: performedById
  };
  await appointment.save();

  // Get/create doctor queue session
  await DoctorQueueSession.getOrCreate(doctorId, department, queueDate, room);

  // Log the event
  await QueueEventLog.create({
    queueEntryId: queueEntry._id,
    appointmentId,
    doctorId,
    patientId,
    eventType: 'CHECKED_IN',
    newStatus: 'waiting',
    newZone: 'WAITING_POOL',
    performedBy: performedById,
    performedByRole,
    queueDate,
    remarks: `Appointment check-in. Arrival status: ${arrivalStatus}. Token: ${queueEntry.queueNumber}`
  });

  await queueEntry.populate([
    { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
    { path: 'doctor', select: 'firstName lastName specialization' },
    { path: 'checkedInBy', select: 'firstName lastName' }
  ]);

  return { queueEntry, appointment, token: queueEntry.queueNumber, arrivalStatus, estimatedWaitMinutes, policy };
};

// ── Walk-in Check-in ──────────────────────────────────────────────────────────

/**
 * Check in a walk-in patient (no prior appointment).
 *
 * @param {object} opts
 * @param {string} opts.patientId
 * @param {string} opts.performedById
 * @param {string} opts.performedByRole
 * @param {string} opts.room
 * @param {string} opts.department
 * @param {string} opts.doctorId
 * @param {string} [opts.notes]
 * @param {boolean} [opts.isEmergency]
 * @param {'normal'|'urgent'} [opts.priority]
 * @returns {Promise<{ queueEntry, token, estimatedWaitMinutes }>}
 */
const checkInWalkIn = async ({
  patientId,
  performedById,
  performedByRole,
  room,
  department,
  doctorId,
  notes,
  isEmergency = false,
  priority = 'normal'
}) => {
  // Validate patient exists
  const patient = await User.findById(patientId);
  if (!patient || patient.role !== 'patient') {
    const err = new Error('Patient not found');
    err.statusCode = 404;
    throw err;
  }

  // Validate doctor exists
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
    doctor: doctorId,
    queueDate,
    status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  if (existing) {
    const err = new Error('Patient already has an active queue entry with this doctor today');
    err.statusCode = 409;
    err.data = { existingEntry: existing };
    throw err;
  }

  const tokenType = resolveTokenType({ isEmergency, isWalkIn: true });
  const policy = await QueuePolicy.resolveFor(doctorId, department);
  const session = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate });
  const avgMins = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
  const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate, avgMins);

  let priorityScore = isEmergency ? 10 : (priority === 'urgent' ? 50 : 300);
  priorityScore += Date.now() / 1e13; // tiny tiebreak by check-in time

  const MAX_TOKEN_RETRIES = 5;
  let queueEntry;
  for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
    const { queueNumber, sequenceNumber } = await generateToken(doctorId, queueDate, tokenType);
    try {
      queueEntry = await QueueEntry.create({
        patient: patientId,
        doctor: doctorId,
        appointment: null,
        checkedInBy: performedById,
        room,
        department,
        queueNumber,
        sequenceNumber,
        tokenType,
        priority,
        priorityScore,
        isWalkIn: !isEmergency,
        isEmergency,
        isLate: false,
        notes,
        estimatedWaitMinutes,
        checkInTime: new Date(),
        queueDate,
        status: isEmergency ? 'emergency_waiting' : 'waiting',
        zone: 'WAITING_POOL',
        sortOrder: priorityScore
      });
      break; // success
    } catch (err) {
      if (err.code === 11000) {
        if (attempt === MAX_TOKEN_RETRIES - 1) {
          throw new Error('Unable to generate a unique queue token. Please try again.');
        }
        continue;
      }
      throw err;
    }
  }

  // Get/create session
  await DoctorQueueSession.getOrCreate(doctorId, department, queueDate, room);

  await QueueEventLog.create({
    queueEntryId: queueEntry._id,
    appointmentId: null,
    doctorId,
    patientId,
    eventType: isEmergency ? 'EMERGENCY_INSERTED' : 'CHECKED_IN',
    newStatus: queueEntry.status,
    newZone: 'WAITING_POOL',
    performedBy: performedById,
    performedByRole,
    queueDate,
    remarks: `Walk-in check-in${isEmergency ? ' (EMERGENCY)' : ''}. Token: ${queueEntry.queueNumber}`
  });

  await queueEntry.populate([
    { path: 'patient', select: 'firstName lastName phone digitalHealthCardId' },
    { path: 'doctor', select: 'firstName lastName specialization' },
    { path: 'checkedInBy', select: 'firstName lastName' }
  ]);

  return { queueEntry, token: queueEntry.queueNumber, estimatedWaitMinutes, policy };
};

module.exports = { getAppointmentEligibility, checkInAppointment, checkInWalkIn };
