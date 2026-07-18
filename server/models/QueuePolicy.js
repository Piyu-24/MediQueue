const mongoose = require('mongoose');

// QueuePolicy holds the queue rules, set per doctor, per department, or globally.
// When a policy is needed we look for a doctor one first, then department, then the global default.
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

  // Check-in window
  // How many minutes before the appointment a patient can check in
  earlyCheckInMinutes: {
    type: Number,
    default: 300
  },
  // How many minutes late before the patient is marked late
  gracePeriodMinutes: {
    type: Number,
    default: 15
  },

  // How many patients to lock into the ready zone
  readyZoneSize: {
    type: Number,
    default: 3,
    min: 1,
    max: 10
  },

  // Default consultation length used for ETAs when there's no history
  averageConsultationMinutes: {
    type: Number,
    default: 10,
    min: 1
  },

  // Walk-in rule:
  // 'after_appointments' - walk-ins go behind booked patients
  // 'by_checkin_time'    - mix walk-ins and booked patients by arrival time
  walkInPriorityRule: {
    type: String,
    enum: ['after_appointments', 'by_checkin_time'],
    default: 'after_appointments'
  },

  // Late arrival rule:
  // 'end_of_pool'    - send to the bottom of the waiting pool
  // 'penalty_offset' - lose N positions
  // 'normal'         - no penalty
  lateArrivalRule: {
    type: String,
    enum: ['end_of_pool', 'penalty_offset', 'normal'],
    default: 'end_of_pool'
  },
  // Only used when lateArrivalRule is 'penalty_offset'
  latePenaltyPositions: {
    type: Number,
    default: 5
  },

  // Whether an emergency can push a ready-zone patient back
  emergencyOverrideAllowed: {
    type: Boolean,
    default: true
  },

  // Dynamic queue settings
  // Master switch - if off, fall back to the old priorityScore sort
  queueRecalculationEnabled: {
    type: Boolean,
    default: true
  },
  // Keep the in-consultation patient from being moved
  currentConsultationLocked: {
    type: Boolean,
    default: true
  },
  // Turn on the emergency priority zone
  emergencyPriorityEnabled: {
    type: Boolean,
    default: true
  },
  // Where emergency patients go (between current and ready zone)
  emergencyPlacement: {
    type: String,
    enum: ['after_current_before_ready'],
    default: 'after_current_before_ready'
  },
  // Emergencies don't interrupt the current consultation
  emergencyInterruptsCurrentConsultation: {
    type: Boolean,
    default: false
  },
  // Don't reorder ready-zone patients during normal recalculation
  readyZoneLockedForNormalPatients: {
    type: Boolean,
    default: true
  },
  // But an emergency can shift the ready zone down
  readyZoneCanBeShiftedByEmergency: {
    type: Boolean,
    default: true
  },
  // Mix appointment and walk-in patients by a ratio
  appointmentWalkInFairnessEnabled: {
    type: Boolean,
    default: true
  },
  // Appointments per cycle (default ratio 2 appointments : 1 walk-in)
  appointmentRatio: {
    type: Number,
    default: 2,
    min: 1
  },
  // Walk-ins per cycle
  walkInRatio: {
    type: Number,
    default: 1,
    min: 1
  },
  // Very late appointments are treated as walk-ins for ordering
  lateOutsideGraceTreatedAs: {
    type: String,
    enum: ['walk_in'],
    default: 'walk_in'
  },
  // Sort mode: 'policy_based' (dynamic engine) or 'legacy' (old sort)
  defaultSortMode: {
    type: String,
    enum: ['policy_based', 'legacy'],
    default: 'policy_based'
  },

  // Minutes of inactivity before the session auto-closes (0 = never)
  sessionAutoCloseMinutes: {
    type: Number,
    default: 0
  },

  // Capacity split
  // Percentage of total capacity offered for online booking
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

  // Where a late patient goes when they check in:
  // 'next_after_current', 'end_of_pool', or 'after_ready_zone'
  lateArrivalInsertionRule: {
    type: String,
    enum: ['next_after_current', 'end_of_pool', 'after_ready_zone'],
    default: 'next_after_current'
  },

  // How the A/W token counter is grouped:
  // 'dept_date_session' (per block), 'dept_date' (per day), 'doctor_date' (per doctor)
  tokenScope: {
    type: String,
    enum: ['dept_date_session', 'dept_date', 'doctor_date'],
    default: 'dept_date_session'
  },

  // Minutes after the appointment before auto no-show (0 = never)
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

// Find the policy to use: doctor, then department, then global, then built-in defaults
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

  // Fallback defaults if nothing is in the DB
  return {
    earlyCheckInMinutes: 30,
    gracePeriodMinutes: 15,
    readyZoneSize: 3,
    averageConsultationMinutes: 10,
    walkInPriorityRule: 'after_appointments',
    lateArrivalRule: 'end_of_pool',
    latePenaltyPositions: 5,
    emergencyOverrideAllowed: true,
    sessionAutoCloseMinutes: 0,
    // dynamic queue settings
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
