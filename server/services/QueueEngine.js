const QueueEntry         = require('../models/QueueEntry');
const QueueEventLog      = require('../models/QueueEventLog');
const QueuePolicy        = require('../models/QueuePolicy');
const DoctorQueueSession = require('../models/DoctorQueueSession');

// QueueEngine works out the order patients are called in.
// It runs after any queue change (check-in, consultation start/finish, skip, no-show...).
//
// Order of the queue:
//   1. CURRENT      - patient currently with the doctor (never moved)
//   2. EMERGENCY    - emergency patients, called next
//   3. READY        - patients already locked into the ready zone
//   4. WAITING_POOL - appointments and walk-ins mixed by a ratio (default 2 appts : 1 walk-in)
//
// Emergencies are never mixed into that ratio - they jump ahead of the waiting patients.
// Appointments that arrive very late get treated like walk-ins for ordering.

const ACTIVE_STATUSES = ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'];

// Decide how a waiting patient should be treated, based on when they arrived.
// Returns: 'emergency', 'appointment_on_time', 'appointment_grace',
// 'walk_in', or 'late_outside_grace' (too late, treated as a walk-in).
const classifyPoolEntry = (entry) => {
  if (entry.isEmergency || entry.status === 'emergency_waiting') return 'emergency';
  if (entry.isWalkIn) return 'walk_in';

  // Use the pre-computed arrivalStatus stored at check-in time
  const status = entry.arrivalStatus;
  if (status === 'late_outside_grace') return 'late_outside_grace';
  if (status === 'late_within_grace')  return 'appointment_grace';
  // 'on_time', 'early_allowed', or any legacy entries without arrivalStatus
  return 'appointment_on_time';
};

// Sort emergency patients by check-in time, then token number, then created time
const sortEmergencyGroup = (entries) =>
  [...entries].sort((a, b) => {
    const tDiff = new Date(a.checkInTime) - new Date(b.checkInTime);
    if (tDiff !== 0) return tDiff;
    const sDiff = (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
    if (sDiff !== 0) return sDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

// Sort appointment patients by appointment time, then arrival, then token number.
// appointmentTime is a 'HH:MM' string, which sorts correctly as text.
const sortAppointmentGroup = (entries) =>
  [...entries].sort((a, b) => {
    // Primary: scheduled appointment time (earlier appointments go first)
    const aTime = a.appointmentTime || '99:99';
    const bTime = b.appointmentTime || '99:99';
    if (aTime < bTime) return -1;
    if (aTime > bTime) return  1;
    // Secondary: who arrived first
    const tDiff = new Date(a.checkInTime) - new Date(b.checkInTime);
    if (tDiff !== 0) return tDiff;
    // Tertiary: token sequence number
    const sDiff = (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
    if (sDiff !== 0) return sDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

// Sort walk-in patients (and very-late appointments) by check-in time, then token number
const sortWalkInGroup = (entries) =>
  [...entries].sort((a, b) => {
    const tDiff = new Date(a.checkInTime) - new Date(b.checkInTime);
    if (tDiff !== 0) return tDiff;
    const sDiff = (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
    if (sDiff !== 0) return sDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

// Mix appointments and walk-ins by a ratio (default 2 appointments per 1 walk-in).
// Keep taking apptRatio appointments then walkInRatio walk-ins until both run out.
// e.g. [A3,A4,A5,A6] + [W2,W3] -> [A3,A4,W2,A5,A6,W3]
const mixAppointmentsAndWalkIns = (appointments, walkIns, apptRatio = 2, walkInRatio = 1) => {
  const result = [];
  let ai = 0;
  let wi = 0;

  while (ai < appointments.length || wi < walkIns.length) {
    for (let i = 0; i < apptRatio && ai < appointments.length; i++) {
      result.push(appointments[ai++]);
    }
    for (let i = 0; i < walkInRatio && wi < walkIns.length; i++) {
      result.push(walkIns[wi++]);
    }
  }

  return result;
};

// Build the final order: current, then emergency, then ready zone, then the mixed waiting list
const buildFinalOrderedList = ({
  current,
  emergency,
  readyZone,
  appointments,
  walkIns,
  apptRatio,
  walkInRatio,
  fairnessEnabled
}) => {
  const mixedWaiting = fairnessEnabled
    ? mixAppointmentsAndWalkIns(appointments, walkIns, apptRatio, walkInRatio)
    : [...appointments, ...walkIns]; // if fairness is off, appointments first then walk-ins

  return [
    ...current,
    ...emergency,
    ...readyZone,
    ...mixedWaiting
  ];
};

// Recalculate the whole queue order for a doctor on a given date.
// This is the main function; it runs after every queue change.
const recalculate = async (doctorId, queueDate, io = null) => {
  try {
    const [session, policy] = await Promise.all([
      DoctorQueueSession.findOne({ doctor: doctorId, queueDate }),
      QueuePolicy.resolveFor(doctorId, null)
    ]);

    const avgMins      = session?.avgConsultationMinutes || policy.averageConsultationMinutes || 10;
    const readyZoneSize = policy.readyZoneSize || 3;

    // Policy flags with safe defaults
    const fairnessEnabled    = policy.appointmentWalkInFairnessEnabled !== false;
    const emergencyEnabled   = policy.emergencyPriorityEnabled !== false;
    const apptRatio          = policy.appointmentRatio  ?? 2;
    const walkInRatio        = policy.walkInRatio        ?? 1;

    // Load all active queue entries for this doctor/day
    const allActive = await QueueEntry.find({
      doctor:   doctorId,
      queueDate,
      status:   { $in: ACTIVE_STATUSES }
    }).lean();

    if (allActive.length === 0) return;

    // The patient in consultation is never moved
    const current    = allActive.filter(e => e.status === 'in_consultation');
    const currentIds = new Set(current.map(e => e._id.toString()));

    // Keep the already-locked ready-zone patients in their current order
    const readyZone = allActive
      .filter(e => e.status === 'ready' && e.isLocked && !currentIds.has(e._id.toString()))
      .sort((a, b) => a.sortOrder - b.sortOrder); // preserve existing order
    const readyIds  = new Set(readyZone.map(e => e._id.toString()));

    // Everyone else can still be reordered
    const pool = allActive.filter(
      e => !currentIds.has(e._id.toString()) && !readyIds.has(e._id.toString())
    );

    // Pull out emergency patients first, so they don't count against the
    // ready-zone size or get mixed with the appointment/walk-in ratio
    const emergencyPool = emergencyEnabled
      ? pool.filter(e => e.isEmergency || e.status === 'emergency_waiting')
      : [];
    const emergencyIds  = new Set(emergencyPool.map(e => e._id.toString()));

    const sortedEmergency = sortEmergencyGroup(emergencyPool);

    // The rest of the movable pool (non-emergency)
    const normalPool = pool.filter(e => !emergencyIds.has(e._id.toString()));

    // Split them into appointment vs walk-in buckets
    const onTimeAppts    = []; // on time or early
    const graceAppts     = []; // a bit late but still get appointment priority
    const walkIns        = []; // real walk-ins
    const lateOutside    = []; // too late, treated like walk-ins

    for (const entry of normalPool) {
      const classification = classifyPoolEntry(entry);
      switch (classification) {
        case 'appointment_on_time': onTimeAppts.push(entry);  break;
        case 'appointment_grace':   graceAppts.push(entry);   break;
        case 'walk_in':             walkIns.push(entry);      break;
        case 'late_outside_grace':  lateOutside.push(entry);  break;
        default:                    walkIns.push(entry);       break; // fallback
      }
    }

    // Sort each bucket
    const sortedOnTime  = sortAppointmentGroup(onTimeAppts);
    const sortedGrace   = sortAppointmentGroup(graceAppts);
    const sortedWalkIns = sortWalkInGroup(walkIns);
    const sortedLate    = sortWalkInGroup(lateOutside);

    // On-time appointments first, then the grace-period ones
    const appointments = [...sortedOnTime, ...sortedGrace];
    // Real walk-ins first, then the too-late appointments
    const allWalkIns   = [...sortedWalkIns, ...sortedLate];

    // Fill any empty ready-zone slots from the normal pool (not emergencies)
    const slotsAvailable  = Math.max(0, readyZoneSize - readyZone.length);
    const newlyReadyList  = [];
    const remainingWaiting = [];

    // Build the mixed appointment/walk-in order first
    const normalOrderedForReady = fairnessEnabled
      ? mixAppointmentsAndWalkIns(appointments, allWalkIns, apptRatio, walkInRatio)
      : [...appointments, ...allWalkIns];

    let slotsLeft = slotsAvailable;
    for (const entry of normalOrderedForReady) {
      if (slotsLeft > 0) {
        newlyReadyList.push(entry);
        slotsLeft--;
      } else {
        remainingWaiting.push(entry);
      }
    }

    // Put the whole queue together in order; this drives the sortOrder below
    const orderedList = [
      ...current,
      ...sortedEmergency,
      ...readyZone,
      ...newlyReadyList,
      ...remainingWaiting
    ];

    // Set sortOrder, zone, status and ETA for each entry
    const newlyReadyIds    = new Set(newlyReadyList.map(e => e._id.toString()));
    const bulkOps          = [];
    const logEntries       = [];
    let   position         = 0;

    for (const entry of orderedList) {
      let newZone, newStatus, isLocked;

      if (currentIds.has(entry._id.toString())) {
        newZone    = 'CURRENT';
        newStatus  = 'in_consultation';
        isLocked   = true;
      } else if (emergencyIds.has(entry._id.toString())) {
        // Emergency patients stay in the WAITING_POOL zone but are next to call
        newZone    = 'WAITING_POOL';
        newStatus  = 'emergency_waiting';
        isLocked   = false;
      } else if (readyIds.has(entry._id.toString())) {
        newZone    = 'READY';
        newStatus  = 'ready';
        isLocked   = true;
      } else if (newlyReadyIds.has(entry._id.toString())) {
        newZone    = 'READY';
        newStatus  = 'ready';
        isLocked   = true;
      } else {
        newZone    = 'WAITING_POOL';
        newStatus  = 'waiting';
        isLocked   = false;
      }

      // Patients ahead = positions before this one, not counting the one in consultation
      const patientsAhead   = Math.max(0, position - (current.length > 0 ? 1 : 0));
      const estimatedWait   = patientsAhead * avgMins;
      const newSortOrder    = position;

      const changed =
        entry.sortOrder            !== newSortOrder   ||
        entry.zone                 !== newZone        ||
        entry.status               !== newStatus      ||
        entry.patientsAheadCount   !== patientsAhead  ||
        entry.estimatedWaitMinutes !== estimatedWait  ||
        entry.isLocked             !== isLocked;

      if (changed) {
        bulkOps.push({
          updateOne: {
            filter: { _id: entry._id },
            update: {
              $set: {
                sortOrder:            newSortOrder,
                zone:                 newZone,
                status:               newStatus,
                patientsAheadCount:   patientsAhead,
                estimatedWaitMinutes: estimatedWait,
                isLocked
              }
            }
          }
        });

        if (entry.sortOrder !== newSortOrder || entry.zone !== newZone) {
          logEntries.push({
            queueEntryId:    entry._id,
            appointmentId:   entry.appointment || null,
            doctorId,
            patientId:       entry.patient,
            eventType:       entry.zone !== newZone ? 'ZONE_CHANGED' : 'SORT_ORDER_CHANGED',
            oldStatus:       entry.status,
            newStatus,
            oldZone:         entry.zone,
            newZone,
            oldSortOrder:    entry.sortOrder,
            newSortOrder,
            oldEstimatedWait: entry.estimatedWaitMinutes,
            newEstimatedWait: estimatedWait,
            queueDate,
            remarks: entry.isEmergency
              ? `Emergency patient placed at position ${newSortOrder} (next-to-call).`
              : `Queue recalculated. arrivalStatus: ${entry.arrivalStatus || 'n/a'}. Position: ${newSortOrder}.`
          });
        }
      }

      position++;
    }

    // Save the changes
    if (bulkOps.length    > 0) await QueueEntry.bulkWrite(bulkOps);
    if (logEntries.length > 0) await QueueEventLog.insertMany(logEntries);

    // Push the updated queue to connected clients
    if (io) {
      const updatedEntries = await QueueEntry.find({
        doctor:   doctorId,
        queueDate,
        status:   { $in: [...ACTIVE_STATUSES, 'skipped', 'temporarily_away'] }
      })
        .populate('patient',    'firstName lastName phone digitalHealthCardId')
        .populate('doctor',     'firstName lastName specialization')
        .populate('appointment', 'appointmentReference appointmentToken timeBlockId')
        .sort({ sortOrder: 1 })
        .lean();

      const payload = {
        doctorId,
        queueDate,
        entries:       updatedEntries,
        sessionStatus: session?.status      || 'active',
        delayMessage:  session?.delayMessage || null,
        policyMode:    policy.defaultSortMode || 'policy_based'
      };

      io.emit('queue:recalculated',    payload);
      io.emit('queue:display:update', { doctorId, queueDate });
    }

  } catch (err) {
    console.error('QueueEngine.recalculate error:', err);
    // Don't let a queue error crash the request that called it
  }
};

// Get the current queue for a doctor, grouped by zone (used by the API)
const getQueueView = async (doctorId, queueDate) => {
  const [entries, session] = await Promise.all([
    QueueEntry.find({
      doctor:   doctorId,
      queueDate,
      status:   { $in: [...ACTIVE_STATUSES, 'skipped', 'temporarily_away', 'completed', 'no_show'] }
    })
      .populate('patient',    'firstName lastName phone digitalHealthCardId')
      .populate('doctor',     'firstName lastName specialization')
      .populate('appointment', 'appointmentReference appointmentToken timeBlockId')
      .sort({ sortOrder: 1, checkInTime: 1 })
      .lean(),
    DoctorQueueSession.findOne({ doctor: doctorId, queueDate }).lean()
  ]);

  const current   = entries.filter(e => e.zone === 'CURRENT');
  const emergency = entries.filter(e => e.isEmergency && e.zone === 'WAITING_POOL' && ACTIVE_STATUSES.includes(e.status));
  const ready     = entries.filter(e => e.zone === 'READY');
  const waiting   = entries.filter(e => e.zone === 'WAITING_POOL' && !e.isEmergency && ACTIVE_STATUSES.includes(e.status));
  const completed = entries.filter(e => e.status === 'completed');
  const skipped   = entries.filter(e => e.status === 'skipped');
  const away      = entries.filter(e => e.status === 'temporarily_away');
  const noShow    = entries.filter(e => e.status === 'no_show');

  return {
    session,
    current,
    emergency,
    ready,
    waiting,
    completed,
    skipped,
    away,
    noShow,
    totalActive: current.length + emergency.length + ready.length + waiting.length
  };
};

module.exports = {
  recalculate,
  getQueueView,
  // exported so the tests can use them
  classifyPoolEntry,
  sortEmergencyGroup,
  sortAppointmentGroup,
  sortWalkInGroup,
  mixAppointmentsAndWalkIns,
  buildFinalOrderedList
};
