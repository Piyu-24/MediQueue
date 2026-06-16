const QueueEntry         = require('../models/QueueEntry');
const QueueEventLog      = require('../models/QueueEventLog');
const QueuePolicy        = require('../models/QueuePolicy');
const DoctorQueueSession = require('../models/DoctorQueueSession');

/**
 * QueueEngine — core recalculation service for live queue management.
 *
 * Called after every queue-state-changing action:
 *   check-in, consultation start/complete, skip, return, no-show,
 *   pause/resume, emergency insertion.
 *
 * Priority ordering (lower sortOrder = served sooner):
 *   0. CURRENT        — in_consultation (locked, never reordered)
 *   1. Emergency      — emergency_waiting (override all)
 *   2. Late patients  — isLate=true, when lateArrivalInsertionRule='next_after_current'
 *   3. READY zone     — next N locked patients
 *   4. Waiting pool   — appointment patients by priorityScore → check-in time
 *   5. Walk-ins       — after appointment patients
 *   6. Late patients  — when rule='after_ready_zone' or 'end_of_pool'
 *
 * Late patient insertion is configurable via QueuePolicy.lateArrivalInsertionRule:
 *   'next_after_current'  — default; late patients go right after CURRENT consultation
 *   'after_ready_zone'    — late patients go after the READY zone but before rest of pool
 *   'end_of_pool'         — late patients go to the bottom (sorted by priorityScore only)
 */

const ACTIVE_STATUSES = ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'];

/**
 * Recalculate the full queue for a doctor on a given date.
 *
 * @param {string} doctorId   MongoDB ObjectId string
 * @param {string} queueDate  YYYY-MM-DD
 * @param {object} [io]       Socket.io server instance (optional)
 */
const recalculate = async (doctorId, queueDate, io = null) => {
  try {
    // ── Load policy and session ────────────────────────────────────────────────
    const [session, policy] = await Promise.all([
      DoctorQueueSession.findOne({ doctor: doctorId, queueDate }),
      QueuePolicy.resolveFor(doctorId, null)
    ]);

    const avgMins      = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
    const readyZoneSize = policy.readyZoneSize || 3;
    const lateRule      = policy.lateArrivalInsertionRule || 'next_after_current';

    // ── Load all active entries ────────────────────────────────────────────────
    const allActive = await QueueEntry.find({
      doctor:   doctorId,
      queueDate,
      status:   { $in: ACTIVE_STATUSES }
    }).lean();

    if (allActive.length === 0) return;

    // ── Partition: CURRENT, READY (already locked), pool ─────────────────────
    const current      = allActive.filter(e => e.status === 'in_consultation');
    const alreadyReady = allActive.filter(e => e.status === 'ready' && e.isLocked);

    // Everything not in CURRENT or READY is the working pool
    const currentIds = new Set(current.map(e => e._id.toString()));
    const readyIds   = new Set(alreadyReady.map(e => e._id.toString()));
    const pool       = allActive.filter(
      e => !currentIds.has(e._id.toString()) && !readyIds.has(e._id.toString())
    );

    // ── Late patient extraction ────────────────────────────────────────────────
    // For 'next_after_current' and 'after_ready_zone' rules, late appointment
    // patients are pulled out of the normal pool and inserted at a fixed position.
    // For 'end_of_pool', they remain in the pool and are sorted by priorityScore.

    let lateForSpecialInsertion = [];
    let workingPool             = pool;

    if (lateRule === 'next_after_current' || lateRule === 'after_ready_zone') {
      lateForSpecialInsertion = pool
        .filter(e => e.isLate && !e.isEmergency)
        .sort((a, b) => {
          // Sort late patients by their original appointment token number (ascending)
          const aNum = a.originalTokenNumber ?? a.sequenceNumber ?? 999999;
          const bNum = b.originalTokenNumber ?? b.sequenceNumber ?? 999999;
          if (aNum !== bNum) return aNum - bNum;
          // Tiebreak: earlier check-in time
          return new Date(a.checkInTime) - new Date(b.checkInTime);
        });

      if (lateForSpecialInsertion.length > 0) {
        const lateIds = new Set(lateForSpecialInsertion.map(e => e._id.toString()));
        workingPool   = pool.filter(e => !lateIds.has(e._id.toString()));
      }
    }

    // ── Sort working pool ─────────────────────────────────────────────────────
    // Priority order within normal pool:
    //  1. Emergency patients    (priorityScore ≈ 10)
    //  2. Urgent appointments   (priorityScore ≈ 20)
    //  3. On-time appointments  (priorityScore 100 + apptTime fraction)
    //  4. Walk-ins              (priorityScore 300+)
    //  5. Tiebreak: check-in time
    const sortedWorkingPool = [...workingPool].sort((a, b) => {
      if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore;
      return new Date(a.checkInTime) - new Date(b.checkInTime);
    });

    // ── Build READY zone from sorted normal pool ───────────────────────────────
    // Emergency patients skip the ready zone (they should be called immediately).
    // Only fill up to readyZoneSize from non-emergency, non-locked pool entries.
    const newlyReady       = [];
    const poolRemainder    = [];
    let readySlotsAvailable = Math.max(0, readyZoneSize - alreadyReady.length);

    for (const entry of sortedWorkingPool) {
      if (entry.status === 'emergency_waiting' || entry.isEmergency) {
        // Emergencies go to the TOP of poolRemainder (sorted first by priorityScore)
        poolRemainder.push(entry);
        continue;
      }
      if (readySlotsAvailable > 0 && !entry.isLocked) {
        newlyReady.push(entry);
        readySlotsAvailable--;
      } else {
        poolRemainder.push(entry);
      }
    }

    // Emergency entries within poolRemainder should sort before non-emergency entries.
    // They have a very low priorityScore (≈10) so they're already first in poolRemainder.

    // ── Assemble final ordered list ────────────────────────────────────────────
    // Order depends on lateArrivalInsertionRule:
    //
    //  next_after_current:
    //    [current] [late] [alreadyReady] [newlyReady] [poolRemainder]
    //
    //  after_ready_zone:
    //    [current] [alreadyReady] [newlyReady] [late] [poolRemainder]
    //
    //  end_of_pool (or normal):
    //    [current] [alreadyReady] [newlyReady] [poolRemainder]
    //    (late patients are already inside poolRemainder via workingPool)

    let orderedList;
    if (lateRule === 'next_after_current') {
      orderedList = [...current, ...lateForSpecialInsertion, ...alreadyReady, ...newlyReady, ...poolRemainder];
    } else if (lateRule === 'after_ready_zone') {
      orderedList = [...current, ...alreadyReady, ...newlyReady, ...lateForSpecialInsertion, ...poolRemainder];
    } else {
      // 'end_of_pool' — late patients remain in pool, sorted by priorityScore (200+)
      orderedList = [...current, ...alreadyReady, ...newlyReady, ...poolRemainder];
    }

    // ── Assign sortOrder, zone, ETA ────────────────────────────────────────────
    const bulkOps    = [];
    const logEntries = [];
    let position     = 0;

    for (const entry of orderedList) {
      let newZone, newStatus;

      if (entry.status === 'in_consultation') {
        newZone   = 'CURRENT';
        newStatus = 'in_consultation';
      } else if (alreadyReady.some(r => r._id.toString() === entry._id.toString())) {
        newZone   = 'READY';
        newStatus = 'ready';
      } else if (newlyReady.some(r => r._id.toString() === entry._id.toString())) {
        newZone   = 'READY';
        newStatus = 'ready';
      } else {
        newZone   = 'WAITING_POOL';
        newStatus = entry.status === 'emergency_waiting' ? 'emergency_waiting' : 'waiting';
      }

      // Late patients inserted via special rule stay in WAITING_POOL (not promoted to READY)
      // — they will be called after CURRENT finishes, before the ready zone gets shifted
      if (lateForSpecialInsertion.some(l => l._id.toString() === entry._id.toString())) {
        newZone   = 'WAITING_POOL';
        newStatus = 'waiting';
      }

      const patientsAhead    = Math.max(0, position - (current.length > 0 ? 1 : 0));
      const estimatedWait    = patientsAhead * avgMins;
      const newSortOrder     = position;
      const isLocked         = newZone === 'READY' || newZone === 'CURRENT';

      const changed =
        entry.sortOrder             !== newSortOrder ||
        entry.zone                  !== newZone      ||
        entry.status                !== newStatus    ||
        entry.patientsAheadCount    !== patientsAhead ||
        entry.estimatedWaitMinutes  !== estimatedWait;

      if (changed) {
        bulkOps.push({
          updateOne: {
            filter: { _id: entry._id },
            update: {
              $set: {
                sortOrder:           newSortOrder,
                zone:                newZone,
                status:              newStatus,
                patientsAheadCount:  patientsAhead,
                estimatedWaitMinutes: estimatedWait,
                isLocked
              }
            }
          }
        });

        if (entry.sortOrder !== newSortOrder || entry.zone !== newZone) {
          logEntries.push({
            queueEntryId: entry._id,
            appointmentId: entry.appointment || null,
            doctorId,
            patientId:    entry.patient,
            eventType:    entry.zone !== newZone ? 'ZONE_CHANGED' : 'SORT_ORDER_CHANGED',
            oldStatus:    entry.status,
            newStatus,
            oldZone:      entry.zone,
            newZone,
            oldSortOrder: entry.sortOrder,
            newSortOrder,
            oldEstimatedWait: entry.estimatedWaitMinutes,
            newEstimatedWait: estimatedWait,
            queueDate,
            remarks: entry.isLate
              ? `Late patient insertion (rule: ${lateRule}). Position: ${newSortOrder}`
              : 'Queue recalculation'
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
        sessionStatus: session?.status     || 'active',
        delayMessage:  session?.delayMessage || null,
        lateRule
      };

      io.emit('queue:recalculated',    payload);
      io.emit('queue:display:update', { doctorId, queueDate });
    }

  } catch (err) {
    console.error('QueueEngine.recalculate error:', err);
    // Engine failures must not crash the calling request
  }
};

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
  const ready     = entries.filter(e => e.zone === 'READY');
  const waiting   = entries.filter(e => e.zone === 'WAITING_POOL' && ACTIVE_STATUSES.includes(e.status));
  const late      = waiting.filter(e => e.isLate);
  const completed = entries.filter(e => e.status === 'completed');
  const skipped   = entries.filter(e => e.status === 'skipped');
  const away      = entries.filter(e => e.status === 'temporarily_away');
  const noShow    = entries.filter(e => e.status === 'no_show');

  return {
    session,
    current,
    ready,
    waiting,
    late,
    completed,
    skipped,
    away,
    noShow,
    totalActive: current.length + ready.length + waiting.length
  };
};

module.exports = { recalculate, getQueueView };
