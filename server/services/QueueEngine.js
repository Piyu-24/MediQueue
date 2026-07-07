const QueueEntry         = require('../models/QueueEntry');
const QueueEventLog      = require('../models/QueueEventLog');
const QueuePolicy        = require('../models/QueuePolicy');
const DoctorQueueSession = require('../models/DoctorQueueSession');

/**
 * QueueEngine — zone-aware, policy-driven queue recalculation service.
 *
 * Called after every queue-state-changing action:
 *   check-in, consultation start/complete, skip, return, no-show,
 *   pause/resume, emergency insertion.
 *
 * Final queue zone order (lower sortOrder = served sooner):
 *   Zone 0 — CURRENT        : in_consultation patient (locked, never reordered)
 *   Zone 1 — EMERGENCY      : emergency_waiting patients (next-to-call)
 *   Zone 2 — READY          : already-locked ready-zone patients (shifted below emergency)
 *   Zone 3 — WAITING_POOL   : appointment + walk-in patients mixed by fairness ratio
 *
 * Emergency placement rule:
 *   - If no current consultation: emergency becomes the first to call.
 *   - If current consultation exists: emergency becomes the very next patient.
 *   - Emergency patients are NEVER mixed into appointment/walk-in fairness ratio.
 *   - Multiple emergencies are sorted by checkInTime → sequenceNumber → createdAt.
 *
 * Appointment / walk-in fairness (default 2A : 1W):
 *   - On-time appointments and late-within-grace appointments both get appointment priority.
 *   - Appointments arrive late outside grace → treated as walk-ins for ordering.
 *   - Walk-ins are never starved: the ratio ensures regular interleaving.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'];

// ── Pure Helper Functions ─────────────────────────────────────────────────────

/**
 * Classify how an entry should be treated in the movable waiting pool.
 * Reads the pre-computed `arrivalStatus` field set at check-in time.
 *
 * Returns one of:
 *   'emergency'           — emergency patient
 *   'appointment_on_time' — on-time or early appointment (gets appointment priority)
 *   'appointment_grace'   — late-within-grace appointment (still gets appointment priority)
 *   'walk_in'             — genuine walk-in patient
 *   'late_outside_grace'  — appointment who arrived too late (demoted to walk-in pool)
 *
 * @param {object} entry — lean QueueEntry document
 * @returns {string}
 */
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

/**
 * Sort emergency patients:
 *   checkInTime ASC → sequenceNumber ASC → createdAt ASC
 *
 * @param {object[]} entries
 * @returns {object[]} sorted copy
 */
const sortEmergencyGroup = (entries) =>
  [...entries].sort((a, b) => {
    const tDiff = new Date(a.checkInTime) - new Date(b.checkInTime);
    if (tDiff !== 0) return tDiff;
    const sDiff = (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
    if (sDiff !== 0) return sDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

/**
 * Sort appointment patients (on-time or late-within-grace):
 *   appointmentTime ASC → checkInTime ASC → sequenceNumber ASC → createdAt ASC
 *
 * appointmentTime is stored as 'HH:MM' string; we compare lexicographically
 * which is correct for zero-padded 24-hour time strings.
 *
 * @param {object[]} entries
 * @returns {object[]} sorted copy
 */
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

/**
 * Sort walk-in patients (and late-outside-grace appointments treated as walk-ins):
 *   checkInTime ASC → sequenceNumber ASC → createdAt ASC
 *
 * @param {object[]} entries
 * @returns {object[]} sorted copy
 */
const sortWalkInGroup = (entries) =>
  [...entries].sort((a, b) => {
    const tDiff = new Date(a.checkInTime) - new Date(b.checkInTime);
    if (tDiff !== 0) return tDiff;
    const sDiff = (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
    if (sDiff !== 0) return sDiff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

/**
 * Mix appointment patients and walk-in patients using a configurable ratio.
 *
 * Algorithm:
 *   Repeat until both arrays are exhausted:
 *     Take up to `apptRatio` appointments, then up to `walkInRatio` walk-ins.
 *
 * Examples (ratio 2A:1W):
 *   [A3,A4,A5,A6] + [W2,W3]   → [A3,A4,W2,A5,A6,W3]
 *   [A3]          + [W1,W2,W3] → [A3,W1,W2,W3]
 *   [A3,A4,A5]    + []         → [A3,A4,A5]
 *   []            + [W1,W2]    → [W1,W2]
 *
 * @param {object[]} appointments — sorted appointment entries
 * @param {object[]} walkIns      — sorted walk-in entries
 * @param {number}   apptRatio    — appointments per cycle (default 2)
 * @param {number}   walkInRatio  — walk-ins per cycle (default 1)
 * @returns {object[]} mixed ordered list
 */
const mixAppointmentsAndWalkIns = (appointments, walkIns, apptRatio = 2, walkInRatio = 1) => {
  const result = [];
  let ai = 0; // appointment pointer
  let wi = 0; // walk-in pointer

  while (ai < appointments.length || wi < walkIns.length) {
    // Take up to apptRatio appointments
    for (let i = 0; i < apptRatio && ai < appointments.length; i++) {
      result.push(appointments[ai++]);
    }
    // Take up to walkInRatio walk-ins
    for (let i = 0; i < walkInRatio && wi < walkIns.length; i++) {
      result.push(walkIns[wi++]);
    }
  }

  return result;
};

/**
 * Build the final ordered list from the four zones.
 *
 * Zone order:
 *   [current] + [emergency] + [readyZone] + [mixed waiting]
 *
 * Note: if there is no current consultation, emergency patients become
 * the first to be called (they occupy position 0).
 *
 * @param {object}   opts
 * @param {object[]} opts.current        — in_consultation entries (0 or 1)
 * @param {object[]} opts.emergency      — sorted emergency entries
 * @param {object[]} opts.readyZone      — existing locked ready-zone entries
 * @param {object[]} opts.appointments   — sorted on-time + grace appointment entries
 * @param {object[]} opts.walkIns        — sorted walk-in + late-outside-grace entries
 * @param {number}   opts.apptRatio
 * @param {number}   opts.walkInRatio
 * @param {boolean}  opts.fairnessEnabled
 * @returns {object[]} final ordered list
 */
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
    : [...appointments, ...walkIns]; // fallback: appointments first, then walk-ins

  return [
    ...current,
    ...emergency,
    ...readyZone,
    ...mixedWaiting
  ];
};

// ── Recalculate ───────────────────────────────────────────────────────────────

/**
 * Recalculate the full queue for a doctor on a given date.
 *
 * This is the authoritative queue ordering function. It is called after
 * every check-in, consultation state change, skip, return, or no-show.
 *
 * @param {string} doctorId   MongoDB ObjectId string
 * @param {string} queueDate  YYYY-MM-DD
 * @param {object} [io]       Socket.io server instance (optional, for real-time push)
 */
const recalculate = async (doctorId, queueDate, io = null) => {
  try {
    // ── Load policy and session ────────────────────────────────────────────────
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

    // ── Load all active entries ────────────────────────────────────────────────
    const allActive = await QueueEntry.find({
      doctor:   doctorId,
      queueDate,
      status:   { $in: ACTIVE_STATUSES }
    }).lean();

    if (allActive.length === 0) return;

    // ── Zone 0: Lock current consultation ─────────────────────────────────────
    // The in_consultation patient is NEVER moved by recalculation.
    const current    = allActive.filter(e => e.status === 'in_consultation');
    const currentIds = new Set(current.map(e => e._id.toString()));

    // ── Zone 2: Preserve existing ready-zone entries ──────────────────────────
    // Locked ready-zone patients keep their relative order.
    // They will be shifted below emergency patients in the final list.
    const readyZone = allActive
      .filter(e => e.status === 'ready' && e.isLocked && !currentIds.has(e._id.toString()))
      .sort((a, b) => a.sortOrder - b.sortOrder); // preserve existing order
    const readyIds  = new Set(readyZone.map(e => e._id.toString()));

    // ── Movable pool: everything that is NOT current or already-ready ──────────
    const pool = allActive.filter(
      e => !currentIds.has(e._id.toString()) && !readyIds.has(e._id.toString())
    );

    // ── Zone 1: Emergency patients from pool ──────────────────────────────────
    // Emergency patients are extracted BEFORE the ready-zone rebuild so they
    // are NEVER counted against readyZoneSize or mixed with A/W patients.
    const emergencyPool = emergencyEnabled
      ? pool.filter(e => e.isEmergency || e.status === 'emergency_waiting')
      : [];
    const emergencyIds  = new Set(emergencyPool.map(e => e._id.toString()));

    const sortedEmergency = sortEmergencyGroup(emergencyPool);

    // ── Normal movable pool (non-emergency, non-current, non-ready) ────────────
    const normalPool = pool.filter(e => !emergencyIds.has(e._id.toString()));

    // ── Classify normal pool into appointment / walk-in buckets ───────────────
    const onTimeAppts    = []; // on_time + early_allowed
    const graceAppts     = []; // late_within_grace (still get appointment priority)
    const walkIns        = []; // genuine walk-in patients
    const lateOutside    = []; // late_outside_grace → treated as walk-in for ordering

    for (const entry of normalPool) {
      const classification = classifyPoolEntry(entry);
      switch (classification) {
        case 'appointment_on_time': onTimeAppts.push(entry);  break;
        case 'appointment_grace':   graceAppts.push(entry);   break;
        case 'walk_in':             walkIns.push(entry);      break;
        case 'late_outside_grace':  lateOutside.push(entry);  break;
        default:                    walkIns.push(entry);       break; // safety fallback
      }
    }

    // ── Sort each bucket deterministically ────────────────────────────────────
    const sortedOnTime  = sortAppointmentGroup(onTimeAppts);
    const sortedGrace   = sortAppointmentGroup(graceAppts);
    const sortedWalkIns = sortWalkInGroup(walkIns);
    const sortedLate    = sortWalkInGroup(lateOutside);

    // Merge appointment groups (on-time first, then grace-period late)
    const appointments = [...sortedOnTime, ...sortedGrace];
    // Merge walk-in groups (genuine walk-ins + late-outside-grace)
    const allWalkIns   = [...sortedWalkIns, ...sortedLate];

    // ── Rebuild ready zone from normal pool ───────────────────────────────────
    // This fills any empty READY slots from the normal (non-emergency) pool,
    // but only if the current readyZone is smaller than readyZoneSize.
    // Emergency patients are NOT promoted to ready zone.
    const slotsAvailable  = Math.max(0, readyZoneSize - readyZone.length);
    const newlyReadyList  = [];
    const remainingWaiting = [];

    // Rebuild the full normal queue order first (appointments + walkIns mixed)
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

    // ── Assemble final ordered list ────────────────────────────────────────────
    // [current] + [emergency] + [readyZone (existing locked)] + [newlyReady] + [remainingWaiting]
    //
    // Note: We place newlyReadyList as READY and remainingWaiting as WAITING_POOL.
    // The final orderedList drives sortOrder assignment.
    const orderedList = [
      ...current,
      ...sortedEmergency,
      ...readyZone,
      ...newlyReadyList,
      ...remainingWaiting
    ];

    // ── Assign sortOrder, zone, status, ETA ───────────────────────────────────
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
        // Emergency patients stay in WAITING_POOL zone (they're next-to-call,
        // but the zone is used for display-board distinction).
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

      // Patients ahead = all positions before this one, minus the current consultation
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

    // ── Persist changes ────────────────────────────────────────────────────────
    if (bulkOps.length    > 0) await QueueEntry.bulkWrite(bulkOps);
    if (logEntries.length > 0) await QueueEventLog.insertMany(logEntries);

    // ── Broadcast real-time update ─────────────────────────────────────────────
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
    // Engine failures must not crash the calling request
  }
};

// ── Queue View ────────────────────────────────────────────────────────────────

/**
 * Get the full active queue view for a doctor (used by API endpoints).
 * Returns entries grouped by zone.
 */
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  recalculate,
  getQueueView,
  // Export helpers for unit testing
  classifyPoolEntry,
  sortEmergencyGroup,
  sortAppointmentGroup,
  sortWalkInGroup,
  mixAppointmentsAndWalkIns,
  buildFinalOrderedList
};
