const QueueEntry = require('../models/QueueEntry');
const QueueEventLog = require('../models/QueueEventLog');
const QueuePolicy = require('../models/QueuePolicy');
const DoctorQueueSession = require('../models/DoctorQueueSession');

/**
 * QueueEngine — core recalculation service for live queue management.
 *
 * Called after every queue-state-changing action:
 *   check-in, consultation start/complete, skip, return, no-show,
 *   pause/resume, emergency insertion.
 *
 * Algorithm:
 *  1. Load session + policy for ETA calibration
 *  2. Identify CURRENT patient (in_consultation) — never reordered
 *  3. Identify READY zone (next N locked patients) — only reordered by emergency/admin
 *  4. Sort WAITING_POOL by priorityScore (lower = higher priority)
 *  5. Assign sortOrder, patientsAheadCount, estimatedWaitMinutes, zone
 *  6. Write QueueEventLog entries for meaningful position changes
 *  7. Broadcast Socket.io events
 */

// Active statuses that belong in the live queue
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

    const avgMins = session?.avgConsultationMinutes || policy.averageConsultationMinutes;
    const readyZoneSize = policy.readyZoneSize || 3;

    // ── Load all active entries ───────────────────────────────────────────────
    const allActive = await QueueEntry.find({
      doctor: doctorId,
      queueDate,
      status: { $in: ACTIVE_STATUSES }
    }).lean();

    if (allActive.length === 0) return;

    // ── Partition by zone ─────────────────────────────────────────────────────

    // CURRENT: patient currently in consultation (there should be at most 1)
    const current = allActive.filter(e => e.status === 'in_consultation');

    // READY: already locked-in ready zone patients
    const alreadyReady = allActive.filter(e => e.status === 'ready' && e.isLocked);

    // WAITING POOL: everything else (waiting, called, emergency_waiting)
    const pool = allActive.filter(
      e => !current.find(c => c._id.toString() === e._id.toString()) &&
           !alreadyReady.find(r => r._id.toString() === e._id.toString())
    );

    // ── Sort waiting pool ─────────────────────────────────────────────────────
    // Priority order:
    //  1. Emergency patients (emergency_waiting, priorityScore ≈ 10)
    //  2. Urgent appointment patients (priorityScore ≈ 20)
    //  3. On-time appointment patients (priorityScore 100 + apptTime fraction)
    //  4. Late appointment patients (priorityScore 200+)
    //  5. Walk-in patients (priorityScore 300+)
    //  6. Tiebreak within same score: check-in time (earlier first)
    const sortedPool = [...pool].sort((a, b) => {
      if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore;
      return new Date(a.checkInTime) - new Date(b.checkInTime);
    });

    // ── Promote to READY zone ─────────────────────────────────────────────────
    // Already-locked ready patients keep their position.
    // Fill up to readyZoneSize from the sorted pool (excluding emergencies, which bypass).
    const newlyReady = [];
    let poolRemainder = [];
    let readySlotsAvailable = Math.max(0, readyZoneSize - alreadyReady.length);

    for (const entry of sortedPool) {
      // Emergency patients skip the ready zone and go directly to top of pool
      if (entry.status === 'emergency_waiting' || entry.isEmergency) {
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

    // Final ordered list:
    // [current(0-1)] [alreadyReady] [newlyReady] [poolRemainder]
    const orderedList = [...current, ...alreadyReady, ...newlyReady, ...poolRemainder];

    // ── Assign new sort orders, zones, and ETA ────────────────────────────────
    const bulkOps = [];
    const logEntries = [];
    let position = 0;

    for (const entry of orderedList) {
      let newZone, newStatus;

      if (entry.status === 'in_consultation') {
        newZone = 'CURRENT';
        newStatus = entry.status;
      } else if (alreadyReady.find(r => r._id.toString() === entry._id.toString())) {
        newZone = 'READY';
        newStatus = 'ready';
      } else if (newlyReady.find(r => r._id.toString() === entry._id.toString())) {
        newZone = 'READY';
        newStatus = 'ready';
      } else {
        newZone = 'WAITING_POOL';
        newStatus = entry.status === 'emergency_waiting' ? 'emergency_waiting' : 'waiting';
      }

      const patientsAhead = Math.max(0, position - (current.length > 0 ? 1 : 0));
      const estimatedWait = patientsAhead * avgMins;
      const newSortOrder = position;
      const isLocked = newZone === 'READY' || newZone === 'CURRENT';

      const changed =
        entry.sortOrder !== newSortOrder ||
        entry.zone !== newZone ||
        entry.status !== newStatus ||
        entry.patientsAheadCount !== patientsAhead ||
        entry.estimatedWaitMinutes !== estimatedWait;

      if (changed) {
        bulkOps.push({
          updateOne: {
            filter: { _id: entry._id },
            update: {
              $set: {
                sortOrder: newSortOrder,
                zone: newZone,
                status: newStatus,
                patientsAheadCount: patientsAhead,
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
            patientId: entry.patient,
            eventType: entry.zone !== newZone ? 'ZONE_CHANGED' : 'SORT_ORDER_CHANGED',
            oldStatus: entry.status,
            newStatus,
            oldZone: entry.zone,
            newZone,
            oldSortOrder: entry.sortOrder,
            newSortOrder,
            oldEstimatedWait: entry.estimatedWaitMinutes,
            newEstimatedWait: estimatedWait,
            queueDate,
            remarks: 'Queue recalculation'
          });
        }
      }

      position++;
    }

    // ── Persist changes ───────────────────────────────────────────────────────
    if (bulkOps.length > 0) {
      await QueueEntry.bulkWrite(bulkOps);
    }
    if (logEntries.length > 0) {
      await QueueEventLog.insertMany(logEntries);
    }

    // ── Broadcast real-time update ────────────────────────────────────────────
    if (io) {
      const updatedEntries = await QueueEntry.find({
        doctor: doctorId,
        queueDate,
        status: { $in: [...ACTIVE_STATUSES, 'skipped', 'temporarily_away'] }
      })
        .populate('patient', 'firstName lastName phone digitalHealthCardId')
        .populate('doctor', 'firstName lastName specialization')
        .sort({ sortOrder: 1 })
        .lean();

      const payload = {
        doctorId,
        queueDate,
        entries: updatedEntries,
        sessionStatus: session?.status || 'active',
        delayMessage: session?.delayMessage || null
      };

      io.emit('queue:recalculated', payload);
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
      doctor: doctorId,
      queueDate,
      status: { $in: [...ACTIVE_STATUSES, 'skipped', 'temporarily_away', 'completed', 'no_show'] }
    })
      .populate('patient', 'firstName lastName phone digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization')
      .populate('appointment', 'appointmentReference appointmentTime')
      .sort({ sortOrder: 1, checkInTime: 1 })
      .lean(),
    DoctorQueueSession.findOne({ doctor: doctorId, queueDate }).lean()
  ]);

  const current = entries.filter(e => e.zone === 'CURRENT');
  const ready = entries.filter(e => e.zone === 'READY');
  const waiting = entries.filter(e => e.zone === 'WAITING_POOL' && ACTIVE_STATUSES.includes(e.status));
  const completed = entries.filter(e => e.status === 'completed');
  const skipped = entries.filter(e => e.status === 'skipped');
  const away = entries.filter(e => e.status === 'temporarily_away');
  const noShow = entries.filter(e => e.status === 'no_show');

  return {
    session,
    current,
    ready,
    waiting,
    completed,
    skipped,
    away,
    noShow,
    totalActive: current.length + ready.length + waiting.length
  };
};

module.exports = { recalculate, getQueueView };
