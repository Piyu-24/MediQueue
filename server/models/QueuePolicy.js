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
    default: 300
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

  // ── Dynamic Queue Policy (v2) ─────────────────────────────────────────────
  /** Master toggle — when false the engine falls back to legacy priorityScore sort */
  queueRecalculationEnabled: {
    type: Boolean,
    default: true
  },
  /** Protects the in_consultation entry from being moved by recalculation */
  currentConsultationLocked: {
    type: Boolean,
    default: true
  },
  /** Enable the emergency priority zone (next-to-call after current consultation) */
  emergencyPriorityEnabled: {
    type: Boolean,
    default: true
  },
  /**
   * Where emergency patients are placed:
   *   'after_current_before_ready' — between current consultation and ready zone (default)
   */
  emergencyPlacement: {
    type: String,
    enum: ['after_current_before_ready'],
    default: 'after_current_before_ready'
  },
  /** Emergency patients do NOT automatically interrupt the current consultation */
  emergencyInterruptsCurrentConsultation: {
    type: Boolean,
    default: false
  },
  /** Ready-zone patients are not reordered during normal appointment/walk-in recalculation */
  readyZoneLockedForNormalPatients: {
    type: Boolean,
    default: true
  },
  /** Emergency patients are allowed to shift the ready zone down */
  readyZoneCanBeShiftedByEmergency: {
    type: Boolean,
    default: true
  },
  /** Enable ratio-based fairness mixing between appointment and walk-in patients */
  appointmentWalkInFairnessEnabled: {
    type: Boolean,
    default: true
  },
  /**
   * How many appointment patients to serve per cycle.
   * Default ratio is 2 appointment : 1 walk-in.
   */
  appointmentRatio: {
    type: Number,
    default: 2,
    min: 1
  },
  /** How many walk-in patients to serve per cycle */
  walkInRatio: {
    type: Number,
    default: 1,
    min: 1
  },
  /**
   * How to treat appointment patients who arrive after lateGraceMinutes:
   *   'walk_in' — demote to walk-in pool for ordering purposes (default)
   */
  lateOutsideGraceTreatedAs: {
    type: String,
    enum: ['walk_in'],
    default: 'walk_in'
  },
  /**
   * Queue sort mode:
   *   'policy_based' — use the dynamic zone-aware engine (default)
   *   'legacy'       — fall back to legacy priorityScore sort
   */
  defaultSortMode: {
    type: String,
    enum: ['policy_based', 'legacy'],
    default: 'policy_based'
  },

  // ── Session Auto-close ────────────────────────────────────────────────────────
  /** Minutes of inactivity before the doctor session auto-closes (0 = disabled) */
  sessionAutoCloseMinutes: {
    type: Number,
    default: 0
  },

  // ── Capacity Allocation ───────────────────────────────────────────────────────
  // What percentage of totalCapacity to expose for online appointment booking
  appointmentCapacityPercentage: {
    type: Number,
    default: 65,
    min: [0, 'Cannot be negative'],
    max: [100, 'Cannot exceed 100']
  },
  // What percentage to reserve for walk-ins (managed by reception)
  walkInCapacityPercentage: {
    type: Number,
    default: 25,
    min: [0, 'Cannot be negative'],
    max: [100, 'Cannot exceed 100']
  },
  // What percentage to hold as emergency buffer (hidden from normal booking)
  emergencyBufferPercentage: {
    type: Number,
    default: 5,
    min: [0, 'Cannot be negative'],
    max: [100, 'Cannot exceed 100']
  },
  // Hard cap on appointments per time block (overrides percentage if set)
  maxAppointmentsPerBlock: {
    type: Number,
    default: null
  },
  // Hard cap on walk-ins per session
  maxWalkInsPerSession: {
    type: Number,
    default: null
  },

  // ── Late Arrival Insertion ────────────────────────────────────────────────────
  /**
   * Where a late appointment patient is inserted once they check in:
   *   'next_after_current' — becomes the next patient after the current consultation
   *   'end_of_pool'        — sent to the end of the waiting pool
   *   'after_ready_zone'   — inserted after the READY zone, before WAITING_POOL
   */
  lateArrivalInsertionRule: {
    type: String,
    enum: ['next_after_current', 'end_of_pool', 'after_ready_zone'],
    default: 'next_after_current'
  },

  // ── Token Scope ───────────────────────────────────────────────────────────────
  /**
   * Determines how the A/W token counter is scoped:
   *   'dept_date_session' — one counter per (department + date + time block)
   *   'dept_date'         — one counter per (department + date), shared across blocks
   *   'doctor_date'       — one counter per (doctor + date), for specialist queues
   */
  tokenScope: {
    type: String,
    enum: ['dept_date_session', 'dept_date', 'doctor_date'],
    default: 'dept_date_session'
  },

  // ── No-Show Cutoff ────────────────────────────────────────────────────────────
  /** Minutes after appointment time before patient is auto-marked no-show (0 = never auto) */
  noShowCutoffMinutes: {
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
    // ── Existing fields ──────────────────────────────────────────────────────
    earlyCheckInMinutes: 30,
    gracePeriodMinutes: 15,
    readyZoneSize: 3,
    averageConsultationMinutes: 10,
    walkInPriorityRule: 'after_appointments',
    lateArrivalRule: 'end_of_pool',
    latePenaltyPositions: 5,
    emergencyOverrideAllowed: true,
    sessionAutoCloseMinutes: 0,
    // ── Dynamic queue policy (v2) fields ─────────────────────────────────────
    queueRecalculationEnabled: true,
    currentConsultationLocked: true,
    emergencyPriorityEnabled: true,
    emergencyPlacement: 'after_current_before_ready',
    emergencyInterruptsCurrentConsultation: false,
    readyZoneLockedForNormalPatients: true,
    readyZoneCanBeShiftedByEmergency: true,
    appointmentWalkInFairnessEnabled: true,
    appointmentRatio: 2,
    walkInRatio: 1,
    lateOutsideGraceTreatedAs: 'walk_in',
    defaultSortMode: 'policy_based'
  };
};

module.exports = mongoose.model('QueuePolicy', queuePolicySchema);
