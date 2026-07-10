const mongoose = require('mongoose');

/**
 * QueueEntry — source of truth for the active live queue.
 *
 * Lifecycle:
 *   waiting → ready → in_consultation → completed
 *   waiting → skipped  (doctor action; patient can return)
 *   waiting/ready → temporarily_away  (patient stepped out)
 *   temporarily_away → waiting  (patient returned)
 *   waiting/ready → no_show
 *   emergency_waiting → (same path as waiting)
 *
 * Token formats (scoped per doctor per queueDate):
 *   A001  appointment patient
 *   W001  walk-in patient
 *   E001  emergency patient
 *
 * Zones:
 *   CURRENT       — patient currently in consultation (locked)
 *   READY         — next N patients (locked unless emergency/admin override)
 *   WAITING_POOL  — rest of the active queue (reorderable)
 *   COMPLETED     — finished entries
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
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null
  },
  checkedInBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Checked-in-by reference is required']
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

  // ── Token Identity ────────────────────────────────────────────────────────────
  /**
   * tokenType: A = appointment, W = walk-in, E = emergency
   * queueNumber: human-readable token, e.g. A001, W003, E001 (fixed after issue)
   * sequenceNumber: raw integer for legacy ordering (kept for migration safety)
   */
  tokenType: {
    type: String,
    enum: ['A', 'W', 'E'],
    default: 'A'
  },
  queueNumber: {
    type: String,
    required: true,
    uppercase: true
  },
  sequenceNumber: {
    type: Number,
    required: true
  },

  // ── Zone & Ordering ───────────────────────────────────────────────────────────
  zone: {
    type: String,
    enum: ['CURRENT', 'READY', 'WAITING_POOL', 'COMPLETED'],
    default: 'WAITING_POOL'
  },
  /**
   * sortOrder determines live position within the waiting pool.
   * Lower value = higher in queue. Recalculated by QueueEngine.
   * Locked entries (READY/CURRENT) keep their position unless admin overrides.
   */
  sortOrder: {
    type: Number,
    default: 0
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  patientsAheadCount: {
    type: Number,
    default: 0
  },

  // ── Status ───────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: [
      'waiting',            // checked in, in the pool
      'ready',              // in the ready zone, about to be called
      'called',             // doctor called this patient
      'in_consultation',    // consultation actively in progress
      'completed',          // consultation done
      'skipped',            // doctor skipped; not a permanent no-show
      'no_show',            // marked as no-show, queue closed for this entry
      'temporarily_away',   // patient stepped out, will return
      'cancelled',          // removed from queue
      'emergency_waiting',  // emergency patient, top priority
      'delayed',            // queue paused by doctor; patient notified
      'unserved_clinic_closed' // clinic session ended before patient was seen
    ],
    default: 'waiting'
  },

  // ── Priority ─────────────────────────────────────────────────────────────────
  priority: {
    type: String,
    enum: ['normal', 'urgent'],
    default: 'normal'
  },
  priorityScore: {
    type: Number,
    default: 100  // lower = higher priority; QueueEngine sets this
  },

  // ── Patient Type Flags ────────────────────────────────────────────────────────
  isWalkIn: { type: Boolean, default: false },
  isEmergency: { type: Boolean, default: false },
  isLate: { type: Boolean, default: false },
  /**
   * Arrival classification stored at check-in time by CheckInService.
   * Used by QueueEngine during recalculation to classify pool entries
   * without needing to re-fetch and re-compute appointment windows.
   *
   *   'on_time'           — arrived within the allowed check-in window (≤ lateGraceMinutes late)
   *   'early_allowed'     — arrived before appointment but within earlyCheckInWindowMinutes
   *   'late_within_grace' — arrived late but within the grace period (still gets appt priority)
   *   'late_outside_grace'— arrived after the grace period (treated as walk-in for ordering)
   *   'walk_in'           — genuine walk-in patient (isWalkIn = true)
   *   'emergency'         — emergency patient (isEmergency = true)
   */
  arrivalStatus: {
    type: String,
    enum: ['on_time', 'early_allowed', 'late_within_grace', 'late_outside_grace', 'walk_in', 'emergency'],
    default: 'on_time'
  },

  // ── Appointment Context ───────────────────────────────────────────────────────
  /** Scheduled appointment time (copied at check-in for ordering; null for block-based) */
  appointmentTime: {
    type: String,
    default: null
  },
  /** Original appointment token (e.g. "A014") — set at booking, copied here at check-in */
  appointmentToken: {
    type: String,
    default: null,
    uppercase: true
  },
  /** Original token sequence number — used for ordering late patients */
  originalTokenNumber: {
    type: Number,
    default: null
  },

  // ── Time Block Context ────────────────────────────────────────────────────────
  /** TimeBlock this entry belongs to (null for legacy exact-time entries) */
  timeBlockId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeBlock',
    default: null,
    index: true,
    sparse: true
  },
  /** Department ObjectId ref (mirrors department string for new-flow entries) */
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true,
    sparse: true
  },

  // ── Late Patient Insertion ────────────────────────────────────────────────────
  /**
   * When a late patient is inserted after the current consultation,
   * this points to the QueueEntry that was CURRENT when the late patient arrived.
   * Used for audit/display; the actual position is driven by sortOrder.
   */
  lateInsertedAfter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QueueEntry',
    default: null
  },

  // ── Timestamps ───────────────────────────────────────────────────────────────
  checkInTime: { type: Date, default: Date.now },
  calledTime: { type: Date },
  consultationStartTime: { type: Date },
  consultationEndTime: { type: Date },
  skippedAt: { type: Date },
  returnedAt: { type: Date },
  temporarilyAwayAt: { type: Date },
  noShowAt: { type: Date },
  /** Set when bulk-marked unserved_clinic_closed by ClinicSessionService */
  unservedAt: { type: Date, default: null },

  // ── ETA ──────────────────────────────────────────────────────────────────────
  estimatedWaitMinutes: { type: Number, default: 0 },
  avgConsultationMinutes: { type: Number, default: 10 },

  // ── Notes ────────────────────────────────────────────────────────────────────
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },

  /** YYYY-MM-DD string for efficient daily queries */
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

queueEntrySchema.virtual('consultationDurationMinutes').get(function () {
  if (!this.consultationStartTime || !this.consultationEndTime) return null;
  return Math.round((this.consultationEndTime - this.consultationStartTime) / 60000);
});

queueEntrySchema.virtual('actualWaitMinutes').get(function () {
  if (!this.checkInTime || !this.calledTime) return null;
  return Math.round((this.calledTime - this.checkInTime) / 60000);
});

// ── Indexes ───────────────────────────────────────────────────────────────────

queueEntrySchema.index({ doctor: 1, queueDate: 1, status: 1 });
queueEntrySchema.index({ doctor: 1, queueDate: 1, sortOrder: 1 });
queueEntrySchema.index({ patient: 1, queueDate: 1 });
queueEntrySchema.index({ department: 1, queueDate: 1, sequenceNumber: 1 });
queueEntrySchema.index({ status: 1, queueDate: 1 });

// Unique: one QueueEntry per appointment (null walk-ins are excluded by sparse)
queueEntrySchema.index({ appointment: 1 }, { unique: true, sparse: true });

// Unique: token must be unique per doctor per day per type
queueEntrySchema.index(
  { doctor: 1, queueDate: 1, queueNumber: 1 },
  { unique: true, name: 'unique_doctor_date_token' }
);

// ── Static Methods ────────────────────────────────────────────────────────────

/**
 * Generate the next candidate token for a doctor on a given date.
 *
 * Uses the highest existing sequenceNumber rather than countDocuments so the
 * result is correct even under concurrent inserts.  The unique index on
 * { doctor, queueDate, queueNumber } is the database-level safety net —
 * callers must catch duplicate-key errors (code 11000) and call this again.
 *
 * @param {string} doctorId
 * @param {string} queueDate   YYYY-MM-DD
 * @param {'A'|'W'|'E'} tokenType
 * @returns {Promise<{ queueNumber: string, sequenceNumber: number }>}
 */
queueEntrySchema.statics.generateToken = async function (doctorId, queueDate, tokenType = 'A') {
  const last = await this.findOne(
    { doctor: doctorId, queueDate, tokenType },
    { sequenceNumber: 1 },
    { sort: { sequenceNumber: -1 } }
  ).lean();
  const sequenceNumber = (last?.sequenceNumber ?? 0) + 1;
  const queueNumber = `${tokenType}${String(sequenceNumber).padStart(3, '0')}`;
  return { queueNumber, sequenceNumber };
};

/**
 * Legacy helper kept for backward compatibility.
 * New code should use generateToken() instead.
 */
queueEntrySchema.statics.generateQueueNumber = async function (department, queueDate) {
  const prefix = department
    .replace(/[^a-zA-Z ]/g, '')
    .split(' ')
    .map(w => w.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 5) || 'OPD';

  const count = await this.countDocuments({ department, queueDate });
  const sequenceNumber = count + 1;
  const queueNumber = `${prefix}-${String(sequenceNumber).padStart(3, '0')}`;
  return { queueNumber, sequenceNumber };
};

/**
 * Calculate estimated wait time for a new patient joining a doctor's queue.
 * ETA = patientsAhead × avgConsultationMinutes
 *
 * @param {string} doctorId
 * @param {string} queueDate
 * @param {number} avgMinutes
 * @returns {number} estimated wait in minutes
 */
queueEntrySchema.statics.calculateETA = async function (doctorId, queueDate, avgMinutes = 10) {
  const waitingCount = await this.countDocuments({
    doctor: doctorId,
    queueDate,
    status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  return waitingCount * avgMinutes;
};

module.exports = mongoose.model('QueueEntry', queueEntrySchema);
