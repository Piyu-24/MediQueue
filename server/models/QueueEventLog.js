const mongoose = require('mongoose');

/**
 * QueueEventLog — immutable audit trail for every meaningful queue state change.
 * Never updated after creation. Used for analytics, debugging, and dispute resolution.
 */
const queueEventLogSchema = new mongoose.Schema({
  // ── References ────────────────────────────────────────────────────────────────
  // null for session-level events (QUEUE_PAUSED, QUEUE_RESUMED) where there is
  // no single QueueEntry responsible for the event.
  queueEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QueueEntry',
    default: null,
    index: true
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // ── Event ─────────────────────────────────────────────────────────────────────
  eventType: {
    type: String,
    required: true,
    enum: [
      'CHECKED_IN',
      'TOKEN_ASSIGNED',
      'QUEUE_RECALCULATED',
      'STATUS_CHANGED',
      'ZONE_CHANGED',
      'CALLED',
      'CONSULTATION_STARTED',
      'CONSULTATION_COMPLETED',
      'SKIPPED',
      'RETURNED',
      'TEMPORARILY_AWAY',
      'NO_SHOW',
      'EMERGENCY_INSERTED',
      'READY_ZONE_LOCKED',
      'QUEUE_PAUSED',
      'QUEUE_RESUMED',
      'SORT_ORDER_CHANGED',
      'CANCELLED',
      'ETA_UPDATED',
      // New event types added for reception workflow
      'MARKED_LATE',
      'DOCTOR_REASSIGNED'
    ],
    index: true
  },

  // ── Before / After ────────────────────────────────────────────────────────────
  oldStatus: { type: String, default: null },
  newStatus: { type: String, default: null },
  oldZone: { type: String, default: null },
  newZone: { type: String, default: null },
  oldSortOrder: { type: Number, default: null },
  newSortOrder: { type: Number, default: null },
  oldEstimatedWait: { type: Number, default: null },
  newEstimatedWait: { type: Number, default: null },

  // ── Actor ─────────────────────────────────────────────────────────────────────
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  performedByRole: {
    type: String,
    default: null
  },

  // ── Context ───────────────────────────────────────────────────────────────────
  queueDate: {
    type: String,
    required: true,
    index: true
  },
  remarks: {
    type: String,
    maxlength: 500,
    default: null
  }

}, {
  // Only createdAt — this collection is append-only
  timestamps: { createdAt: true, updatedAt: false }
});

// Compound index for fetching all events for a queue entry in order
queueEventLogSchema.index({ queueEntryId: 1, createdAt: 1 });
queueEventLogSchema.index({ doctorId: 1, queueDate: 1, createdAt: 1 });

module.exports = mongoose.model('QueueEventLog', queueEventLogSchema);
