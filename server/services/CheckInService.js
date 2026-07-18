const Appointment    = require('../models/Appointment');
const QueueEntry     = require('../models/QueueEntry');
const QueuePolicy    = require('../models/QueuePolicy');
const QueueEventLog  = require('../models/QueueEventLog');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const TimeBlock      = require('../models/TimeBlock');
const User           = require('../models/User');
const { localDateStr }                              = require('./TokenGenerator');
const { nextWalkInToken, nextEmergencyToken, buildScope } = require('./TokenSequenceService');

// CheckInService handles all patient check-ins.
//
// For appointments there are two cases:
//   - General OPD / block-based: the token was already made at booking, so
//     check-in just activates it and reception assigns the doctor.
//   - Old exact-time appointments: the A token is generated here at check-in.
//
// Walk-ins get a W token and emergencies get an E token (see TokenSequenceService).

const TERMINAL_STATUSES       = ['cancelled', 'completed', 'no-show', 'rescheduled', 'doctor-unavailable'];
const ALREADY_ACTIVE_STATUSES = ['checked_in', 'in_queue', 'in_consultation', 'in-progress', 'skipped', 'late', 'delayed'];
const CHECKABLE_STATUSES      = ['booked', 'scheduled', 'confirmed'];

// Turn 'HH:MM' into minutes since midnight
const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Work out the appointment's start datetime, used to check the check-in window.
// Uses the time block's start for block bookings, or appointmentTime otherwise.
const resolveAppointmentDateTime = async (appointment) => {
  const baseDate = new Date(appointment.appointmentDate);
  baseDate.setHours(0, 0, 0, 0);

  // Block booking: use the block's start time
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

  // Otherwise use the exact appointment time
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

// Check whether a patient can check in now, and whether they're early/on-time/late
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

  // Already in the queue?
  const existingEntry = await QueueEntry.findOne({
    appointment: appointmentId,
    status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  if (existingEntry) {
    return { eligible: false, reason: 'Patient is already in the queue', alreadyCheckedIn: true, existingEntry };
  }

  // Get the queue policy (by department for General OPD, by doctor for specialist)
  const policyDoctorId = appointment.doctor?._id || null;
  const policyDeptId   = appointment.departmentId?._id?.toString()
                       || appointment.departmentId?.toString()
                       || null;
  const policy = await QueuePolicy.resolveFor(policyDoctorId, policyDeptId);

  const apptDateTime = await resolveAppointmentDateTime(appointment);

  // If we can't work out the time (very old record), just allow check-in
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

// Turn the arrival status into the value stored on QueueEntry.arrivalStatus,
// which the QueueEngine uses to decide the patient's bucket.
// minutesLate is positive when the patient is late.
const computeRefinedArrivalStatus = (arrivalStatus, minutesLate, policy) => {
  if (arrivalStatus === 'too_early') return 'on_time'; // blocked earlier anyway
  if (arrivalStatus === 'early')     return 'early_allowed';
  if (arrivalStatus === 'on_time')   return 'on_time';
  if (arrivalStatus === 'late') {
    const gracePeriod = policy.gracePeriodMinutes ?? 15;
    if (minutesLate <= gracePeriod) return 'late_within_grace';
    return 'late_outside_grace';
  }
  return 'on_time'; // fallback
};

// Check in a booked appointment patient.
// If the token already exists (booking-time) we activate it; otherwise we make one.
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

  // minutesUntilAppointment is negative when late, so flip the sign
  const minutesLate        = -(eligibility.minutesUntilAppointment ?? 0);
  const refinedArrivalStatus = computeRefinedArrivalStatus(arrivalStatus, minutesLate, policy);

  // Estimated wait from the session average, or the policy default
  const session   = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate });
  const avgMins   = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
  const estimatedWaitMinutes = await QueueEntry.calculateETA(doctorId, queueDate, avgMins);

  // Priority score: urgent patients jump ahead, late patients drop back
  let priorityScore = priority === 'urgent' ? 20 : 100;
  if (isLate) {
    if (policy.lateArrivalRule === 'end_of_pool') {
      priorityScore = 200;
    } else if (policy.lateArrivalRule === 'penalty_offset') {
      priorityScore = 100 + policy.latePenaltyPositions * 10;
    }
  }
  // Tiebreak by scheduled appointment time
  const apptTimeMins = toMinutes(appointment.appointmentTime);
  if (apptTimeMins !== null) priorityScore += apptTimeMins / 10000;

  // Get the token
  let queueNumber, sequenceNumber, tokenType;

  const isNewFlow = !!appointment.appointmentToken;

  if (isNewFlow) {
    // Token was made at booking - just reuse it
    queueNumber    = appointment.appointmentToken;
    sequenceNumber = appointment.tokenNumber;
    tokenType      = appointment.tokenPrefix || 'A';
  } else {
    // Old appointments with no token: generate an A token now
    const { generateToken } = require('./TokenGenerator');
    tokenType = 'A';
    const MAX_TOKEN_RETRIES = 5;
    let tokenResult;
    for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
      tokenResult = await generateToken(doctorId, queueDate, tokenType);
      try {
        queueNumber    = tokenResult.queueNumber;
        sequenceNumber = tokenResult.sequenceNumber;
        break;
      } catch {
        if (attempt === MAX_TOKEN_RETRIES - 1) throw new Error('Unable to generate a unique queue token.');
      }
    }
  }

  // Create the queue entry (retry with a new token if there's a clash, old flow only)
  const MAX_RETRIES = isNewFlow ? 1 : 5;
  let queueEntry;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (!isNewFlow && attempt > 0) {
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
        isWalkIn:     false,
        isEmergency:  false,
        isLate,
        // used by QueueEngine to order the queue
        arrivalStatus: refinedArrivalStatus,
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

  // Update the appointment
  appointment.status = 'in_queue';
  appointment.checkIn = { time: new Date(), method: 'manual', verifiedBy: performedById };
  // Save the doctor if reception just assigned one (General OPD)
  if (!appointment.doctor && doctorId) {
    appointment.doctor = doctorId;
  }
  await appointment.save();

  // Make sure the session exists and log the event
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
    { path: 'patient',     select: 'firstName lastName phone digitalHealthCardId' },
    { path: 'doctor',      select: 'firstName lastName specialization' },
    { path: 'checkedInBy',  select: 'firstName lastName' },
    { path: 'timeBlockId',  select: 'startTime endTime sessionName' }
  ]);

  return { queueEntry, appointment, token: queueEntry.queueNumber, arrivalStatus, estimatedWaitMinutes, policy };
};

// Check in a walk-in patient (no appointment).
// Walk-ins get a W token; emergencies get an E token.
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

  // Walk-ins and appointments share the same number sequence per department/date
  const tokenScopeStr = policy.tokenScope || 'dept_date_session';
  const scope = buildScope({
    departmentId: departmentId || null,
    doctorId:     tokenScopeStr === 'doctor_date' ? doctorId : null,
    date:         queueDate,
    timeBlockId:  null,
    tokenScope:   departmentId ? tokenScopeStr : 'doctor_date'
  });

  // Generate the token
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

  // Priority score (lower = called sooner)
  let priorityScore = isEmergency ? 10 : (priority === 'urgent' ? 50 : 300);
  priorityScore += Date.now() / 1e13; // tiny tiebreak by check-in time

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
    // used by QueueEngine to order the queue
    arrivalStatus: isEmergency ? 'emergency' : 'walk_in',
    notes,
    estimatedWaitMinutes,
    checkInTime: new Date(),
    queueDate,
    status:      isEmergency ? 'emergency_waiting' : 'waiting',
    zone:        'WAITING_POOL',
    sortOrder:   priorityScore
  });

  // Make sure the session exists and log the event
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
    { path: 'patient',     select: 'firstName lastName phone digitalHealthCardId' },
    { path: 'doctor',      select: 'firstName lastName specialization' },
    { path: 'checkedInBy',  select: 'firstName lastName' },
    { path: 'timeBlockId',  select: 'startTime endTime sessionName' }
  ]);

  return { queueEntry, token: queueEntry.queueNumber, estimatedWaitMinutes, policy };
};

module.exports = { getAppointmentEligibility, checkInAppointment, checkInWalkIn, computeRefinedArrivalStatus };

