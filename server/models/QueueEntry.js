const mongoose = require('mongoose');

/**
 * QueueEntry — represents one patient's position in the OPD queue for a given day.
 *
 * Lifecycle:  waiting → called → in-consultation → completed
 *         or: waiting → called → no-show
 *         or: waiting → no-show  (if never called)
 *
 * One active entry per patient per department per day (enforced at service layer).
 */
const queueEntrySchema = new mongoose.Schema({
  // ── Participants ─────────────────────────────────────────────────────────────
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Patient is required']
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Doctor is required']
  },
  /** Linked appointment — null for walk-ins */
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null
  },
  checkedInBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Receptionist reference is required']
  },

  // ── Location ─────────────────────────────────────────────────────────────────
  room: {
    type: String,
    required: [true, 'Room is required'],
    trim: true
  },
  department: {
    type: String,
    required: [true, 'Department is required'],
    trim: true
  },

  // ── Queue Identity ────────────────────────────────────────────────────────────
  /**
   * Human-readable queue number. Format: <DEPT_PREFIX>-<DDD>
   * Examples: OPD-001, CARDIO-007, PEDS-012
   * Sequence resets each day per department.
   */
  queueNumber: {
    type: String,
    required: true,
    uppercase: true
  },
  /** Raw sequence integer for ordering and ETA calculation */
  sequenceNumber: {
    type: Number,
    required: true
  },

  // ── Status ───────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['waiting', 'called', 'in-consultation', 'completed', 'no-show'],
    default: 'waiting'
  },
  priority: {
    type: String,
    enum: ['normal', 'urgent'],
    default: 'normal'
  },
  isWalkIn: {
    type: Boolean,
    default: false
  },

  // ── Timestamps ───────────────────────────────────────────────────────────────
  /** Set when receptionist checks the patient in */
  checkInTime: {
    type: Date,
    default: Date.now
  },
  /** Set when doctor clicks "Call Patient" */
  calledTime: {
    type: Date
  },
  /** Set when doctor clicks "Start Consultation" */
  consultationStartTime: {
    type: Date
  },
  /** Set when doctor clicks "Complete" */
  consultationEndTime: {
    type: Date
  },
  /** Set when doctor or receptionist marks no-show */
  noShowTime: {
    type: Date
  },

  // ── ETA ──────────────────────────────────────────────────────────────────────
  /** Estimated wait in minutes at time of check-in */
  estimatedWaitMinutes: {
    type: Number,
    default: 0
  },
  /** Average consultation duration for this doctor (minutes), used for ETA */
  avgConsultationMinutes: {
    type: Number,
    default: 10
  },

  // ── Notes ────────────────────────────────────────────────────────────────────
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },

  /** Date portion of check-in (YYYY-MM-DD string) for efficient daily queries */
  queueDate: {
    type: String,
    required: true,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ── Virtuals ──────────────────────────────────────────────────────────────────

/** Actual consultation duration in minutes */
queueEntrySchema.virtual('consultationDurationMinutes').get(function () {
  if (!this.consultationStartTime || !this.consultationEndTime) return null;
  return Math.round(
    (this.consultationEndTime - this.consultationStartTime) / 60000
  );
});

/** Total wait time from check-in to being called */
queueEntrySchema.virtual('actualWaitMinutes').get(function () {
  if (!this.checkInTime || !this.calledTime) return null;
  return Math.round((this.calledTime - this.checkInTime) / 60000);
});

// ── Indexes ───────────────────────────────────────────────────────────────────

// Fast daily room queue lookup (doctor and display screen use this heavily)
queueEntrySchema.index({ department: 1, queueDate: 1, sequenceNumber: 1 });
queueEntrySchema.index({ doctor: 1, queueDate: 1, status: 1 });
queueEntrySchema.index({ patient: 1, queueDate: 1 });
queueEntrySchema.index({ status: 1, queueDate: 1 });

// ── Static Methods ────────────────────────────────────────────────────────────

/**
 * Generate the next queue number for a given department on a given date.
 * Format: <PREFIX>-<DDD>  e.g. OPD-007, CARDIO-003
 *
 * @param {string} department  e.g. "General OPD", "Cardiology"
 * @param {string} queueDate   YYYY-MM-DD
 * @returns {{ queueNumber: string, sequenceNumber: number }}
 */
queueEntrySchema.statics.generateQueueNumber = async function (department, queueDate) {
  // Build a short prefix from department name (up to 5 letters, uppercase)
  const prefix = department
    .replace(/[^a-zA-Z ]/g, '')       // strip non-alpha
    .split(' ')
    .map(word => word.charAt(0))      // initials
    .join('')
    .toUpperCase()
    .substring(0, 5) || 'OPD';

  // Count existing entries today for this department
  const count = await this.countDocuments({ department, queueDate });
  const sequenceNumber = count + 1;
  const queueNumber = `${prefix}-${String(sequenceNumber).padStart(3, '0')}`;

  return { queueNumber, sequenceNumber };
};

/**
 * Calculate estimated wait time for a new patient.
 * ETA = (patients currently waiting ahead) × avgConsultationMinutes
 *
 * @param {string} doctorId
 * @param {string} queueDate
 * @param {number} avgMinutes  default 10
 * @returns {number} estimated wait in minutes
 */
queueEntrySchema.statics.calculateETA = async function (doctorId, queueDate, avgMinutes = 10) {
  const waitingCount = await this.countDocuments({
    doctor: doctorId,
    queueDate,
    status: { $in: ['waiting', 'in-consultation'] }
  });
  return waitingCount * avgMinutes;
};

module.exports = mongoose.model('QueueEntry', queueEntrySchema);
