const mongoose = require('mongoose');

/**
 * Consultation — one record per patient-doctor consultation.
 * Created when a doctor starts a consultation (QueueEntry → in_consultation).
 * Completed when the doctor marks it done.
 * Used for calibrating the rolling average consultation duration for ETA.
 */
const consultationSchema = new mongoose.Schema({
  // ── References ────────────────────────────────────────────────────────────────
  queueEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QueueEntry',
    required: true,
    index: true
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // ── Session ───────────────────────────────────────────────────────────────────
  queueDate: {
    type: String,   // YYYY-MM-DD
    required: true,
    index: true
  },

  // ── Timing ───────────────────────────────────────────────────────────────────
  startedAt: {
    type: Date,
    required: true
  },
  completedAt: {
    type: Date,
    default: null
  },
  /** Calculated when completedAt is set */
  durationMinutes: {
    type: Number,
    default: null
  },

  // ── Status ───────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['in_progress', 'completed', 'interrupted'],
    default: 'in_progress'
  },

  // ── Clinical Notes ────────────────────────────────────────────────────────────
  /** Brief notes recorded by doctor during/after consultation */
  notes: {
    type: String,
    maxlength: 2000,
    default: null
  }

}, {
  timestamps: true
});

// Unique: one open consultation per queue entry
consultationSchema.index({ queueEntry: 1 }, { unique: true });
consultationSchema.index({ doctor: 1, queueDate: 1, status: 1 });

/**
 * Mark consultation as completed and calculate duration.
 */
consultationSchema.methods.complete = async function (notes = null) {
  this.completedAt = new Date();
  this.status = 'completed';
  this.durationMinutes = Math.round((this.completedAt - this.startedAt) / 60000);
  if (notes) this.notes = notes;
  await this.save();
  return this;
};

module.exports = mongoose.model('Consultation', consultationSchema);
