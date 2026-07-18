// ClinicSessionService handles closing a doctor's queue session at end of day.
// closeClinicSession marks anyone still waiting as unserved, updates their
// appointments, saves a day-end summary, and ends the session.
// getDayEndReport returns that summary plus the list of unserved patients.

'use strict';

const QueueEntry        = require('../models/QueueEntry');
const QueueEventLog     = require('../models/QueueEventLog');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const Appointment       = require('../models/Appointment');

// Patients still in one of these states when the session closes count as unserved
const UNSERVED_STATUSES = [
  'waiting',
  'ready',
  'called',
  'emergency_waiting',
  'temporarily_away',
  'skipped',
  'delayed'
];

// Entries already in these states are left alone
const TERMINAL_STATUSES = [
  'completed',
  'no_show',
  'cancelled',
  'in_consultation',     // currently being seen
  'unserved_clinic_closed'
];

// Close a doctor's session for the day and build the day-end report
const closeClinicSession = async (doctorId, queueDate, performedById, performedByRole) => {
  // 1. Check the session exists and isn't already closed
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

  // Can't close while a consultation is going on - finish or skip that patient first
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

  // 2. Get all of today's entries for this doctor
  const allEntries = await QueueEntry.find({ doctor: doctorId, queueDate }).lean();

  // 3. Find the unserved ones
  const unservedEntries = allEntries.filter(e => UNSERVED_STATUSES.includes(e.status));
  const unservedIds     = unservedEntries.map(e => e._id);

  // 4. Mark the unserved entries
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

    // 5. Mark their appointments as no-show
    const appointmentIds = unservedEntries
      .filter(e => e.appointment)
      .map(e => e.appointment);

    if (appointmentIds.length > 0) {
      await Appointment.updateMany(
        { _id: { $in: appointmentIds } },
        { $set: { status: 'no-show' } }
      );
    }

    // 6. Log an event for each unserved patient
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

  // 7. Build the day-end summary
  const totalServed    = allEntries.filter(e => e.status === 'completed').length;
  const totalUnserved  = unservedIds.length;
  const totalWaiting   = allEntries.filter(e => UNSERVED_STATUSES.includes(e.status)).length;
  const totalEmergency = allEntries.filter(e => e.isEmergency === true).length;

  const report = {
    generatedAt:            now,
    totalServed,
    totalWaiting,            // patients still in the queue at close
    totalUnserved,
    totalEmergency,
    avgConsultationMinutes:  session.avgConsultationMinutes ?? 0,
    closedBy:                performedById
  };

  // 8. Save the session
  session.status       = 'ended';
  session.endedAt      = now;
  session.closedAt     = now;
  session.dayEndReport = report;
  await session.save();

  // 9. Log the session close
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

// Get the saved day-end report plus the list of patients who weren't seen
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

  // Get the list of unserved patients for staff to follow up
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

module.exports = { closeClinicSession, getDayEndReport, UNSERVED_STATUSES };
