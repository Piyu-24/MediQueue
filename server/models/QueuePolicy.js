const mongoose = require('mongoose');

/**
 * QueuePolicy — configurable rules per doctor and/or department.
 *
 * Resolution order when a policy is needed:
 *   1. Doctor-specific policy (doctorId set, departmentId may also be set)
 *   2. Department-level policy (departmentId set, doctorId null)
 *   3. Global default policy (both null)
 */
const queuePolicySchema = new mongoose.Schema({
  // Scope: doctor-specific, department-level, or global default (both null)
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  departmentId: {
    type: String,
    default: null,
    index: true
  },

  // ── Check-in Window ───────────────────────────────────────────────────────────
  /** How many minutes before appointment time a patient may check in */
  earlyCheckInMinutes: {
    type: Number,
    default: 30
  },
  /** How many minutes after appointment time before patient is marked LATE */
  gracePeriodMinutes: {
    type: Number,
    default: 15
  },

  // ── Ready Zone ────────────────────────────────────────────────────────────────
  /** Number of patients to lock into the READY zone ahead of current consultation */
  readyZoneSize: {
    type: Number,
    default: 3,
    min: 1,
    max: 10
  },

  // ── ETA Calculation ───────────────────────────────────────────────────────────
  /** Default average consultation duration (minutes) when no history is available */
  averageConsultationMinutes: {
    type: Number,
    default: 10,
    min: 1
  },

  // ── Walk-in Rules ─────────────────────────────────────────────────────────────
  /**
   * 'after_appointments'  — walk-ins always go behind booked patients
   * 'by_checkin_time'     — walk-ins mixed with booked patients by arrival time
   */
  walkInPriorityRule: {
    type: String,
    enum: ['after_appointments', 'by_checkin_time'],
    default: 'after_appointments'
  },

  // ── Late Arrival ──────────────────────────────────────────────────────────────
  /**
   * 'end_of_pool'    — late patient goes to bottom of waiting pool
   * 'penalty_offset' — late patient loses N positions from their slot
   * 'normal'         — no penalty (treat as on-time)
   */
  lateArrivalRule: {
    type: String,
    enum: ['end_of_pool', 'penalty_offset', 'normal'],
    default: 'end_of_pool'
  },
  /** Only relevant when lateArrivalRule = 'penalty_offset' */
  latePenaltyPositions: {
    type: Number,
    default: 5
  },

  // ── Emergency Override ────────────────────────────────────────────────────────
  /** Whether an emergency insertion can push a READY-zone patient back */
  emergencyOverrideAllowed: {
    type: Boolean,
    default: true
  },

  // ── Session Auto-close ────────────────────────────────────────────────────────
  /** Minutes of inactivity before the doctor session auto-closes (0 = disabled) */
  sessionAutoCloseMinutes: {
    type: Number,
    default: 0
  }

}, {
  timestamps: true
});

// Ensure only one global default (both null) exists
queuePolicySchema.index(
  { doctorId: 1, departmentId: 1 },
  { unique: true, sparse: true }
);

/**
 * Resolve the effective policy for a given doctor + department.
 * Falls back through: doctor → department → global default → hard-coded defaults.
 */
queuePolicySchema.statics.resolveFor = async function (doctorId, departmentId) {
  // Try doctor-specific first
  if (doctorId) {
    const doctorPolicy = await this.findOne({ doctorId });
    if (doctorPolicy) return doctorPolicy;
  }
  // Try department-level
  if (departmentId) {
    const deptPolicy = await this.findOne({ doctorId: null, departmentId });
    if (deptPolicy) return deptPolicy;
  }
  // Global default
  const global = await this.findOne({ doctorId: null, departmentId: null });
  if (global) return global;

  // Hard-coded fallback — no DB entry needed
  return {
    earlyCheckInMinutes: 30,
    gracePeriodMinutes: 15,
    readyZoneSize: 3,
    averageConsultationMinutes: 10,
    walkInPriorityRule: 'after_appointments',
    lateArrivalRule: 'end_of_pool',
    latePenaltyPositions: 5,
    emergencyOverrideAllowed: true,
    sessionAutoCloseMinutes: 0
  };
};

module.exports = mongoose.model('QueuePolicy', queuePolicySchema);
