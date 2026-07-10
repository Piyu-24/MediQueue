const mongoose = require('mongoose');

/**
 * DoctorQueueSession — one queue session per doctor per day.
 *
 * Tracks whether the doctor is active, paused, or ended for the day.
 * Created automatically when the first patient is checked in for a doctor on a given date.
 */
const doctorQueueSessionSchema = new mongoose.Schema({
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  department: {
    type: String,
    required: true,
    trim: true
  },
  room: {
    type: String,
    trim: true,
    default: null
  },
  queueDate: {
    type: String,   // YYYY-MM-DD
    required: true,
    index: true
  },

  // ── Session Status ────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['active', 'paused', 'ended'],
    default: 'active'
  },

  // ── Timestamps ───────────────────────────────────────────────────────────────
  startedAt: { type: Date, default: Date.now },
  pausedAt: { type: Date, default: null },
  resumedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  /** Set when the session is explicitly closed via ClinicSessionService */
  closedAt: { type: Date, default: null },

  // ── Pause Reason ─────────────────────────────────────────────────────────────
  pauseReason: {
    type: String,
    maxlength: 200,
    default: null
  },

  // ── Current State ─────────────────────────────────────────────────────────────
  /** The QueueEntry currently in CURRENT zone */
  currentQueueEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QueueEntry',
    default: null
  },

  // ── ETA Calibration ──────────────────────────────────────────────────────────
  /** Rolling average consultation duration for this session, updated after each completion */
  avgConsultationMinutes: {
    type: Number,
    default: 10
  },
  consultationsCompleted: {
    type: Number,
    default: 0
  },

  // ── Delay Message ─────────────────────────────────────────────────────────────
  /** Broadcast to patients when queue is paused */
  delayMessage: {
    type: String,
    maxlength: 300,
    default: null
  },

  // ── Day-End Report ────────────────────────────────────────────────────────────
  /**
   * Populated by ClinicSessionService.closeClinicSession().
   * Stores the daily summary inline so it survives without a separate Report doc.
   */
  dayEndReport: {
    generatedAt:            { type: Date,   default: null },
    totalServed:            { type: Number, default: null }, // status: completed
    totalWaiting:           { type: Number, default: null }, // still in queue at close time
    totalUnserved:          { type: Number, default: null }, // marked unserved_clinic_closed
    totalEmergency:         { type: Number, default: null }, // isEmergency across all entries
    avgConsultationMinutes: { type: Number, default: null }, // from session rolling average
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  }

}, {
  timestamps: true
});

// One session per doctor per date
doctorQueueSessionSchema.index({ doctor: 1, queueDate: 1 }, { unique: true });

/**
 * Get or create a session for a doctor on a given date.
 * Called automatically during check-in if no session exists.
 */
doctorQueueSessionSchema.statics.getOrCreate = async function (doctorId, department, queueDate, room = null) {
  let session = await this.findOne({ doctor: doctorId, queueDate });
  if (!session) {
    session = await this.create({
      doctor: doctorId,
      department,
      room,
      queueDate,
      status: 'active'
    });
  }
  return session;
};

/**
 * Update the rolling average consultation duration after a consultation completes.
 * Uses a simple cumulative moving average.
 */
doctorQueueSessionSchema.methods.recordConsultation = async function (durationMinutes) {
  const n = this.consultationsCompleted;
  this.avgConsultationMinutes = Math.round(
    (this.avgConsultationMinutes * n + durationMinutes) / (n + 1)
  );
  this.consultationsCompleted += 1;
  await this.save();
};

module.exports = mongoose.model('DoctorQueueSession', doctorQueueSessionSchema);
