/**
 * ClinicSessionService.js
 *
 * Handles clinic session lifecycle at end-of-day:
 *
 *   closeClinicSession(doctorId, queueDate, performedById)
 *     1. Validates the session exists and is not already ended.
 *     2. Bulk-marks all remaining (non-terminal) queue entries as
 *        `unserved_clinic_closed` and logs each one.
 *     3. Marks linked Appointment records as `no-show`.
 *     4. Computes and stores the day-end summary on the session document.
 *     5. Sets the session status to `ended`.
 *     6. Fires a session-level `SESSION_CLOSED` event log.
 *
 *   getDayEndReport(doctorId, queueDate)
 *     Returns the session's stored dayEndReport plus a patient-level
 *     breakdown of unserved entries (name, token, check-in time) for
 *     staff review.
 */

'use strict';

const QueueEntry        = require('../models/QueueEntry');
const QueueEventLog     = require('../models/QueueEventLog');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const Appointment       = require('../models/Appointment');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Statuses that are "still in queue" when the session closes.
 * Patients in these states have not been seen and will be marked unserved.
 */
const UNSERVED_STATUSES = [
  'waiting',
  'ready',
  'called',
  'emergency_waiting',
  'temporarily_away',
  'skipped',
  'delayed'
];

/**
 * Terminal statuses — entries already in these states are not touched.
 */
const TERMINAL_STATUSES = [
  'completed',
  'no_show',
  'cancelled',
  'in_consultation',     // currently being seen — excluded from unserved
  'unserved_clinic_closed'
];

// ─── closeClinicSession ───────────────────────────────────────────────────────

/**
 * Close a doctor's queue session for today and generate the day-end report.
 *
 * @param {string} doctorId        — MongoDB ObjectId string
 * @param {string} queueDate       — YYYY-MM-DD
 * @param {string} performedById   — userId of the staff/doctor who triggered close
 * @param {string} performedByRole — role of the actor
 * @returns {Promise<{ session: object, report: object, unservedCount: number }>}
 * @throws  {Error} if session not found, already ended, or has active consultation
 */
const closeClinicSession = async (doctorId, queueDate, performedById, performedByRole) => {
  // ── 1. Validate session ──────────────────────────────────────────────────────
  const session = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate });

  if (!session) {
    const err = new Error('No queue session found for this doctor on this date.');
    err.statusCode = 404;
    throw err;
  }

  if (session.status === 'ended') {
    const err = new Error('This queue session has already been closed.');
    err.statusCode = 409;
    throw err;
  }

  // Guard: block close if a consultation is currently in progress.
  // The doctor must complete or skip the active patient first.
  const activeConsultation = await QueueEntry.findOne({
    doctor:    doctorId,
    queueDate,
    status:    'in_consultation'
  }).lean();

  if (activeConsultation) {
    const err = new Error(
      'Cannot close the session while a consultation is in progress. ' +
      'Please complete or skip the current patient first.'
    );
    err.statusCode = 409;
    throw err;
  }

  // ── 2. Fetch all entries for this doctor today ───────────────────────────────
  const allEntries = await QueueEntry.find({ doctor: doctorId, queueDate }).lean();

  // ── 3. Identify unserved entries ─────────────────────────────────────────────
  const unservedEntries = allEntries.filter(e => UNSERVED_STATUSES.includes(e.status));
  const unservedIds     = unservedEntries.map(e => e._id);

  // ── 4. Bulk-update unserved queue entries ────────────────────────────────────
  const now = new Date();

  if (unservedIds.length > 0) {
    await QueueEntry.updateMany(
      { _id: { $in: unservedIds } },
      {
        $set: {
          status:     'unserved_clinic_closed',
          zone:       'COMPLETED',
          isLocked:   false,
          unservedAt: now
        }
      }
    );

    // ── 5. Bulk-update linked Appointment records ────────────────────────────
    const appointmentIds = unservedEntries
      .filter(e => e.appointment)
      .map(e => e.appointment);

    if (appointmentIds.length > 0) {
      await Appointment.updateMany(
        { _id: { $in: appointmentIds } },
        { $set: { status: 'no-show' } }
      );
    }

    // ── 6. Log an UNSERVED_CLINIC_CLOSED event per patient ──────────────────
    const eventDocs = unservedEntries.map(e => ({
      queueEntryId:    e._id,
      appointmentId:   e.appointment || null,
      doctorId,
      patientId:       e.patient,
      eventType:       'UNSERVED_CLINIC_CLOSED',
      oldStatus:       e.status,
      newStatus:       'unserved_clinic_closed',
      oldZone:         e.zone,
      newZone:         'COMPLETED',
      performedBy:     performedById,
      performedByRole,
      queueDate,
      remarks:         'Clinic session closed before patient could be seen.'
    }));

    await QueueEventLog.insertMany(eventDocs, { ordered: false });
  }

  // ── 7. Compute day-end summary ───────────────────────────────────────────────
  const totalServed    = allEntries.filter(e => e.status === 'completed').length;
  const totalUnserved  = unservedIds.length;
  const totalWaiting   = allEntries.filter(e => UNSERVED_STATUSES.includes(e.status)).length;
  const totalEmergency = allEntries.filter(e => e.isEmergency === true).length;

  const report = {
    generatedAt:            now,
    totalServed,
    totalWaiting,            // patients still in queue at close (= unserved candidates)
    totalUnserved,
    totalEmergency,
    avgConsultationMinutes:  session.avgConsultationMinutes ?? 0,
    closedBy:                performedById
  };

  // ── 8. Update the session document ──────────────────────────────────────────
  session.status       = 'ended';
  session.endedAt      = now;
  session.closedAt     = now;
  session.dayEndReport = report;
  await session.save();

  // ── 9. Log a SESSION_CLOSED event ───────────────────────────────────────────
  await QueueEventLog.create({
    queueEntryId:    null,
    doctorId,
    eventType:       'SESSION_CLOSED',
    performedBy:     performedById,
    performedByRole,
    queueDate,
    remarks: `Session closed. Served: ${totalServed}, Unserved: ${totalUnserved}, Emergency: ${totalEmergency}.`
  });

  return { session, report, unservedCount: totalUnserved };
};

// ─── getDayEndReport ─────────────────────────────────────────────────────────

/**
 * Retrieve the stored day-end report for a doctor's session.
 * Also returns a patient-level breakdown of all unserved entries so
 * staff can see who was not seen.
 *
 * @param {string} doctorId
 * @param {string} queueDate  YYYY-MM-DD
 * @returns {Promise<{ session, report, unservedPatients }>}
 * @throws  {Error} if session not found or report not yet generated
 */
const getDayEndReport = async (doctorId, queueDate) => {
  const session = await DoctorQueueSession.findOne({ doctor: doctorId, queueDate })
    .populate('doctor', 'firstName lastName specialization department')
    .lean();

  if (!session) {
    const err = new Error('No queue session found for this doctor on this date.');
    err.statusCode = 404;
    throw err;
  }

  if (!session.dayEndReport?.generatedAt) {
    const err = new Error(
      'Day-end report has not been generated yet. Close the session first.'
    );
    err.statusCode = 400;
    throw err;
  }

  // Fetch unserved patient breakdown for staff follow-up display
  const unservedEntries = await QueueEntry.find({
    doctor:    doctorId,
    queueDate,
    status:    'unserved_clinic_closed'
  })
    .populate('patient', 'firstName lastName phone email')
    .populate('appointment', 'appointmentReference appointmentDate departmentId timeBlockId')
    .sort({ sortOrder: 1, checkInTime: 1 })
    .lean();

  const unservedPatients = unservedEntries.map(e => ({
    queueEntryId:   e._id,
    token:          e.queueNumber,
    tokenType:      e.tokenType,
    isEmergency:    e.isEmergency || false,
    isWalkIn:       e.isWalkIn    || false,
    checkInTime:    e.checkInTime,
    unservedAt:     e.unservedAt,
    patient: {
      id:        e.patient?._id,
      name:      e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : 'Unknown',
      phone:     e.patient?.phone  || null,
      email:     e.patient?.email  || null
    },
    appointmentReference: e.appointment?.appointmentReference || null
  }));

  return {
    session,
    report: session.dayEndReport,
    unservedPatients
  };
};

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { closeClinicSession, getDayEndReport, UNSERVED_STATUSES };
