const TimeBlock = require('../models/TimeBlock');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const QueueEntry = require('../models/QueueEntry');
const AuditLog = require('../models/AuditLog');
const QueueEngine = require('./QueueEngine');

// Appointments in these statuses still belong to a patient who is waiting to be
// seen, so they can be redirected to reschedule when a session is cancelled.
const RESCHEDULABLE_STATUSES = ['booked', 'checked_in', 'in_queue'];
// Statuses that mean the patient is already physically in the live queue.
const IN_QUEUE_STATUSES = ['checked_in', 'in_queue'];
// QueueEntry statuses that are still "live" and must be pulled from the queue.
const ACTIVE_QUEUE_STATUSES = ['waiting', 'ready', 'called', 'emergency_waiting', 'temporarily_away', 'delayed'];

// Cancel a time block (OPD session) and move every affected patient into the
// reschedule flow: their appointment becomes `doctor-unavailable`, their slot is
// released, any live queue entry is pulled, and they are notified in real time.
//
// This is what bridges the block-based OPD model into the existing
// doctor-unavailable → reschedule chain (patient dashboard banner + booking page).
async function cancelBlock({ blockId, reason, actor, io }) {
  const block = await TimeBlock.findById(blockId);
  if (!block) {
    throw Object.assign(new Error('Time block not found'), { statusCode: 404 });
  }

  const wasAlreadyCancelled = block.status === 'cancelled';
  block.status = 'cancelled';
  if (reason) {
    block.notes = String(reason).slice(0, 300);
  }
  await block.save();

  const queueDate = block.date; // YYYY-MM-DD, matches QueueEntry.queueDate

  const appointments = await Appointment.find({
    timeBlockId: block._id,
    status: { $in: RESCHEDULABLE_STATUSES }
  })
    .populate('patient', 'firstName lastName')
    .populate('timeBlockId', 'startTime endTime sessionName');

  const dateStr = new Date(block.date).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
  const sessionLabel = block.sessionName || `${block.startTime}–${block.endTime}`;

  const affectedDoctorIds = new Set();
  let affectedCount = 0;

  for (const appointment of appointments) {
    const previousStatus = appointment.status;

    appointment.status = 'doctor-unavailable';
    appointment.leaveInfo = {
      markedAt: new Date(),
      reason: reason || 'SESSION_CANCELLED',
      previousStatus
    };
    await appointment.save();

    // Free the slot so the counters stay consistent.
    await TimeBlock.releaseAppointmentSlot(block._id);

    // If the patient had already checked in, pull them out of the live queue.
    if (IN_QUEUE_STATUSES.includes(previousStatus)) {
      const entry = await QueueEntry.findOne({
        appointment: appointment._id,
        queueDate,
        status: { $in: ACTIVE_QUEUE_STATUSES }
      });
      if (entry) {
        entry.status = 'cancelled';
        await entry.save();
        if (entry.doctor) affectedDoctorIds.add(entry.doctor.toString());
      }
    }

    // Notify the patient (in-app notification + real-time push).
    try {
      await Notification.create({
        recipient: appointment.patient._id,
        type: 'doctor-unavailable',
        title: 'Session cancelled – please reschedule',
        message: `Your ${appointment.department || 'appointment'} on ${dateStr} (${sessionLabel}) has been cancelled and needs rescheduling.`,
        appointment: appointment._id,
        metadata: {
          appointmentId: appointment._id,
          departmentId: appointment.departmentId,
          department: appointment.department,
          appointmentDate: appointment.appointmentDate,
          sessionLabel,
          reason: reason || 'SESSION_CANCELLED'
        }
      });
    } catch (notifErr) {
      console.error('Block-cancel notification failed (non-fatal):', notifErr.message);
    }

    if (io) {
      io.to(appointment.patient._id.toString()).emit('appointment:doctor-unavailable', {
        appointmentId: appointment._id,
        department: appointment.department,
        appointmentDate: appointment.appointmentDate,
        sessionLabel,
        reason: reason || 'SESSION_CANCELLED'
      });
    }

    affectedCount += 1;
  }

  // Recompute any live queues we pulled patients from.
  for (const doctorId of affectedDoctorIds) {
    try {
      await QueueEngine.recalculate(doctorId, queueDate, io);
    } catch (recalcErr) {
      console.error('Queue recalc after block cancel failed (non-fatal):', recalcErr.message);
    }
  }

  if (actor?.id) {
    try {
      await AuditLog.createLog({
        userId: actor.id,
        userRole: actor.role,
        action: 'CANCEL_TIME_BLOCK',
        resourceType: 'TimeBlock',
        resourceId: block._id,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        description: `Cancelled session ${sessionLabel} on ${block.date}; ${affectedCount} appointment(s) flagged for reschedule`,
        metadata: { blockId: block._id, affectedCount, reason: reason || 'SESSION_CANCELLED', wasAlreadyCancelled }
      });
    } catch (auditErr) {
      console.error('Block-cancel audit log failed (non-fatal):', auditErr.message);
    }
  }

  return { block, affectedCount };
}

module.exports = { cancelBlock };
