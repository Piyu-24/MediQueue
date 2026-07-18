const mongoose = require('mongoose');
const crypto = require('crypto');

const appointmentSchema = new mongoose.Schema({
  // Human-readable reference number, e.g. MQ-20240115-7A3B
  appointmentReference: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },

  // Patient and Doctor Information
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Patient is required']
  },
  // doctor is optional for General OPD bookings (assigned at check-in by reception)
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Appointment Details
  appointmentDate: {
    type: Date,
    required: [true, 'Appointment date is required']
  },
  appointmentTime: {
    type: String,
    // No longer required — new block-based bookings use timeBlockId instead.
    // Legacy exact-time appointments still store this field.
    default: null,
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please provide time in HH:MM format']
  },
  duration: {
    type: Number,
    default: 30, // minutes
    min: [15, 'Minimum appointment duration is 15 minutes'],
    max: [120, 'Maximum appointment duration is 120 minutes']
  },

  // Status and Type
  // Legacy statuses kept for backward compatibility; new statuses added alongside
  status: {
    type: String,
    enum: [
      // ── New flow statuses ──────────────────────────────────────────────────
      'booked',             // token issued at booking; patient not yet checked in
      // ── Legacy / backward-compat statuses ─────────────────────────────────
      'scheduled',          // legacy initial status (exact-time bookings)
      'confirmed',          // legacy / doctor confirmed
      'checked_in',         // patient arrived at hospital
      'in_queue',           // QueueEntry created, patient waiting
      'in-progress',        // legacy alias for in_consultation
      'in_consultation',    // actively being seen
      'completed',          // consultation done
      'cancelled',          // patient or staff cancelled
      'rescheduled',        // moved to a different slot
      'no-show',            // did not arrive
      'skipped',            // was in queue, skipped by doctor
      'late',               // checked in after grace period
      'delayed',            // appointment delayed by doctor
      'doctor-unavailable'  // legacy — doctor on leave
    ],
    default: 'scheduled'
  },
  appointmentType: {
    type: String,
    enum: ['consultation', 'follow-up', 'check-up', 'emergency', 'routine'],
    required: [true, 'Appointment type is required']
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  
  // Medical Information
  chiefComplaint: {
    type: String,
    required: [true, 'Chief complaint is required'],
    maxlength: [500, 'Chief complaint cannot exceed 500 characters']
  },
  symptoms: [String],
  notes: {
    patient: String,
    doctor: String,
    staff: String
  },
  
  // Digital Check-in
  checkIn: {
    time: Date,
    method: {
      type: String,
      enum: ['qr-code', 'manual', 'digital-card']
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  // Follow-up
  followUp: {
    required: {
      type: Boolean,
      default: false
    },
    suggestedDate: Date,
    notes: String
  },
  
  // Prescription and Treatment
  prescription: [{
    medication: String,
    dosage: String,
    frequency: String,
    duration: String,
    instructions: String
  }],
  
  // Vital Signs (recorded during appointment)
  vitalSigns: {
    bloodPressure: {
      systolic: Number,
      diastolic: Number
    },
    heartRate: Number,
    temperature: Number,
    weight: Number,
    height: Number,
    respiratoryRate: Number,
    oxygenSaturation: Number
  },
  
  // Diagnosis
  diagnosis: {
    primary: String,
    secondary: [String],
    icd10Codes: [String]
  },
  
  // Lab Tests and Referrals
  labTests: [{
    testName: String,
    ordered: Boolean,
    completed: Boolean,
    results: String,
    resultDate: Date
  }],
  referrals: [{
    specialization: String,
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    urgent: Boolean
  }],
  
  // Reschedule tracking — set when this appointment was created to replace another
  rescheduledFromAppointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null,
    index: true,
    sparse: true
  },

  // Cancellation
  cancellation: {
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    cancelledAt: Date,
    reason: String
  },

  // Doctor leave impact tracking
  leaveInfo: {
    leaveId: {
      type: String
    },
    markedAt: Date,
    reason: String,
    previousStatus: {
      type: String,
      enum: ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show', 'doctor-unavailable']
    }
  },
  
  // Notifications
  notifications: {
    reminderSent: {
      type: Boolean,
      default: false
    },
    confirmationSent: {
      type: Boolean,
      default: false
    },
    followUpSent: {
      type: Boolean,
      default: false
    }
  },
  
  // Room/Location
  room: String,
  department: String,

  // ── Time-Block Booking Fields (new flow) ──────────────────────────────────────
  // departmentId: ObjectId ref to Department model (new bookings; legacy keeps string `department`)
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true,
    sparse: true
  },
  // Time block selected at booking (replaces exact appointmentTime for new flow)
  timeBlockId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeBlock',
    default: null,
    index: true,
    sparse: true
  },

  // ── Token Fields (new flow) ───────────────────────────────────────────────────
  // Appointment token issued at booking time (e.g. "A014")
  appointmentToken: {
    type: String,
    default: null,
    uppercase: true,
    trim: true,
    index: true,
    sparse: true
  },
  // Raw sequence number (numeric portion of token)
  tokenNumber: {
    type: Number,
    default: null
  },
  // Token prefix: 'A' for appointment (always A at booking)
  tokenPrefix: {
    type: String,
    enum: ['A', 'W', 'E'],
    default: 'A'
  },

  // ── Booking Type ──────────────────────────────────────────────────────────────
  // 'general_opd'  — patient chose department/block; doctor assigned at check-in
  // 'specialist'   — patient chose a specific doctor (legacy and new flow)
  bookingType: {
    type: String,
    enum: ['general_opd', 'specialist'],
    default: 'general_opd'
  },

  // ── Room Assignment (set at check-in, not booking) ───────────────────────────
  // References the Room document for the consultation room assigned to this appointment.
  assignedRoom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    default: null,
    index: true,
    sparse: true
  },

  // ── Reporting Time ────────────────────────────────────────────────────────────
  // When the patient should arrive (calculated at booking: block.startTime - offset)
  reportingTime: {
    type: String,
    default: null,
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM']
  },
  
  // Rating and Feedback
  rating: {
    patientRating: {
      type: Number,
      min: 1,
      max: 5
    },
    patientFeedback: String,
    doctorRating: {
      type: Number,
      min: 1,
      max: 5
    },
    doctorFeedback: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for appointment end time
appointmentSchema.virtual('endTime').get(function() {
  if (!this.appointmentTime || !this.duration) return null;
  
  const [hours, minutes] = this.appointmentTime.split(':').map(Number);
  const startTime = new Date();
  startTime.setHours(hours, minutes, 0, 0);
  
  const endTime = new Date(startTime.getTime() + this.duration * 60000);
  return endTime.toTimeString().slice(0, 5);
});

// Virtual for full appointment datetime
appointmentSchema.virtual('appointmentDateTime').get(function() {
  if (!this.appointmentDate || !this.appointmentTime) return null;
  
  const date = new Date(this.appointmentDate);
  const [hours, minutes] = this.appointmentTime.split(':').map(Number);
  date.setHours(hours, minutes, 0, 0);
  
  return date;
});

// ── Indexes ───────────────────────────────────────────────────────────────────

appointmentSchema.index({ patient: 1, appointmentDate: 1 });
appointmentSchema.index({ doctor: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1, appointmentDate: 1 });
appointmentSchema.index({ appointmentDate: 1, appointmentTime: 1 });
// New-flow indexes
appointmentSchema.index({ departmentId: 1, appointmentDate: 1, status: 1 });
appointmentSchema.index({ timeBlockId: 1, status: 1 });
appointmentSchema.index({ bookingType: 1, status: 1, appointmentDate: 1 });

// Compound index for doctor availability checking
appointmentSchema.index({
  doctor: 1,
  appointmentDate: 1,
  appointmentTime: 1,
  status: 1
});

// Partial unique index — prevents same patient booking same doctor/date/time
// while any active appointment exists. Cancelled/completed/no-show are excluded.
// 'booked' is included so the new token-based flow is covered.
// Index renamed from unique_active_patient_doctor_slot to v2 to force recreation
// when upgrading — run: db.appointments.dropIndex('unique_active_patient_doctor_slot')
appointmentSchema.index(
  { patient: 1, doctor: 1, appointmentDate: 1, appointmentTime: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          'booked',
          'scheduled', 'confirmed', 'checked_in', 'in_queue',
          'in_consultation', 'in-progress', 'late', 'delayed', 'skipped'
        ]
      }
    },
    name: 'unique_active_booking_slot'
  }
);

// Pre-save middleware — only enforce future-date rule on NEW appointments
appointmentSchema.pre('save', function(next) {
  if (this.isNew) {
    // Block-based OPD bookings store the block's startTime in appointmentTime so that
    // field is always "in the past" once the session has started.  For those we only
    // check that the calendar date is today or future — same-day booking is valid.
    const isBlockBased = !!(this.timeBlockId || this.bookingType === 'general_opd');

    if (isBlockBased) {
      if (this.appointmentDate) {
        const apptDate = new Date(this.appointmentDate);
        apptDate.setHours(23, 59, 59, 999);
        if (apptDate < new Date()) {
          return next(new Error('Appointment must be scheduled for today or a future date'));
        }
      }
    } else {
      // Exact-time specialist booking — full datetime must be in the future
      const appointmentDateTime = this.appointmentDateTime;
      if (appointmentDateTime && appointmentDateTime <= new Date()) {
        return next(new Error('Appointment must be scheduled for a future date and time'));
      }
      if (!appointmentDateTime && this.appointmentDate) {
        const apptDate = new Date(this.appointmentDate);
        apptDate.setHours(23, 59, 59, 999);
        if (apptDate <= new Date()) {
          return next(new Error('Appointment must be scheduled for a future date'));
        }
      }
    }
  }
  next();
});

// Auto-generate appointmentReference before first save
appointmentSchema.pre('save', function(next) {
  if (this.isNew && !this.appointmentReference) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    this.appointmentReference = `MQ-${datePart}-${randPart}`;
  }
  next();
});

// All statuses that occupy a slot (conflict-causing).
// 'booked' must be included: it is the initial status for new-flow appointments
// (block-based OPD and specialist+token). Without it, a second booking for the
// same slot would not detect the first one as a conflict.
const ACTIVE_CONFLICT_STATUSES = [
  'booked',
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

/**
 * Active statuses for patient-level booking conflict checks.
 * Matches the business-rule definition exactly:
 *   active = booked | confirmed | checked_in | in_queue | in_consultation
 * Also includes legacy aliases used across the codebase.
 */
const ACTIVE_BOOKING_STATUSES = [
  'booked',
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

// Partial unique index — prevents same patient booking the same time block twice
// (covers both General OPD and specialist+block concurrency).
// Sparse: appointments without a timeBlockId are excluded entirely.
appointmentSchema.index(
  { patient: 1, timeBlockId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      timeBlockId: { $exists: true, $ne: null },
      status: {
        $in: [
          'booked',
          'scheduled', 'confirmed', 'checked_in', 'in_queue',
          'in_consultation', 'in-progress', 'late', 'delayed', 'skipped'
        ]
      }
    },
    name: 'unique_active_patient_timeblock'
  }
);

// ── Patient same-department same-day uniqueness index ─────────────────────────
// Prevents the same patient from holding two active appointments for the same
// department on the same date, even across different time slots.
// Only enforced for new-flow (block-based) bookings that carry a departmentId.
// Sparse: legacy appointments without departmentId are excluded.
appointmentSchema.index(
  { patient: 1, departmentId: 1, appointmentDate: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      departmentId: { $exists: true, $ne: null },
      status: { $in: ACTIVE_BOOKING_STATUSES }
    },
    name: 'unique_active_patient_dept_day'
  }
);

/**
 * Check whether a doctor's calendar has an overlap with the given slot.
 * Used to prevent double-booking a doctor beyond slot capacity.
 *
 * @param {string} doctorId
 * @param {Date|string} date     — appointment date
 * @param {string} time          — "HH:MM"
 * @param {number} duration      — minutes
 * @param {string|null} excludeId — exclude this appointment ID (for reschedule)
 * @returns {Promise<boolean>}
 */
appointmentSchema.statics.hasConflict = async function(doctorId, date, time, duration, excludeId = null) {
  const query = {
    doctor: doctorId,
    appointmentDate: date,
    status: { $in: ACTIVE_CONFLICT_STATUSES }
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await this.find(query).select('appointmentTime duration');
  return _overlapsAny(time, duration, existing);
};

/**
 * Check whether a patient already has an overlapping appointment.
 * Used to prevent a patient from booking two slots at the same time.
 *
 * @param {string} patientId
 * @param {Date|string} date
 * @param {string} time          — "HH:MM"
 * @param {number} duration      — minutes
 * @param {string|null} excludeId — exclude this appointment ID (for reschedule)
 * @returns {Promise<boolean>}
 */
appointmentSchema.statics.hasPatientConflict = async function(patientId, date, time, duration, excludeId = null) {
  const query = {
    patient: patientId,
    appointmentDate: date,
    status: { $in: ACTIVE_CONFLICT_STATUSES }
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await this.find(query).select('appointmentTime duration');
  return _overlapsAny(time, duration, existing);
};

/**
 * Check whether a patient already has an active booking for the same time block.
 * Used to prevent duplicate OPD / specialist+block bookings before slot deduction.
 *
 * @param {string} patientId
 * @param {string} timeBlockId
 * @param {string|null} excludeId — exclude this appointment (for future reschedule flows)
 * @returns {Promise<boolean>}
 */
appointmentSchema.statics.hasOPDDuplicate = async function(patientId, timeBlockId, excludeId = null) {
  const query = {
    patient: patientId,
    timeBlockId,
    status: { $in: ACTIVE_CONFLICT_STATUSES }
  };
  if (excludeId) query._id = { $ne: excludeId };
  return (await this.countDocuments(query)) > 0;
};

/**
 * Validation Rule 1: Same-department same-day block.
 *
 * Returns true if the patient already has an active appointment for the same
 * departmentId on the same date, regardless of time slot.
 *
 * Rule: One patient cannot hold two active appointments for the same department
 * on the same calendar day.
 *
 * @param {string}      patientId
 * @param {string}      departmentId    — ObjectId string
 * @param {string|Date} appointmentDate — YYYY-MM-DD or Date object (start of day used)
 * @param {string|null} excludeId       — exclude this appointment ID (for reschedule)
 * @returns {Promise<boolean>}  true = conflict exists, block the booking
 */
appointmentSchema.statics.hasActiveSameDeptDayConflict = async function(
  patientId,
  departmentId,
  appointmentDate,
  excludeId = null
) {
  // Build day boundaries from the given date string/object
  const dayStart = new Date(appointmentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(appointmentDate);
  dayEnd.setHours(23, 59, 59, 999);

  const query = {
    patient:        patientId,
    departmentId,
    appointmentDate: { $gte: dayStart, $lte: dayEnd },
    status:         { $in: ACTIVE_BOOKING_STATUSES }
  };
  if (excludeId) query._id = { $ne: excludeId };

  return (await this.countDocuments(query)) > 0;
};

/**
 * Validation Rule 2: Cross-department time-block overlap check.
 *
 * Returns a conflicting appointment if the patient has an active appointment on
 * the same date whose time block overlaps the candidate block's window.
 *
 * Overlap condition: newStart < existingEnd AND newEnd > existingStart
 *
 * This check is only needed when the patient is booking a DIFFERENT department
 * (same-department is already caught by hasActiveSameDeptDayConflict above).
 *
 * @param {string}      patientId
 * @param {string}      departmentId     — the NEW booking's department (excluded from search)
 * @param {string|Date} appointmentDate
 * @param {string}      newBlockStart    — HH:MM start time of the candidate block
 * @param {string}      newBlockEnd      — HH:MM end time of the candidate block
 * @param {string|null} excludeId
 * @returns {Promise<object|null>}  conflicting appointment doc, or null if clear
 */
appointmentSchema.statics.hasActiveTimeBlockOverlap = async function(
  patientId,
  departmentId,
  appointmentDate,
  newBlockStart,
  newBlockEnd,
  excludeId = null
) {
  const dayStart = new Date(appointmentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(appointmentDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Fetch all active appointments for this patient on this date, for OTHER departments,
  // that have a timeBlockId (so we can compare block windows).
  const query = {
    patient:         patientId,
    departmentId:    { $ne: departmentId },   // different department only
    appointmentDate: { $gte: dayStart, $lte: dayEnd },
    status:          { $in: ACTIVE_BOOKING_STATUSES },
    timeBlockId:     { $exists: true, $ne: null }
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await this.find(query)
    .populate('timeBlockId', 'startTime endTime')
    .lean();

  // Convert HH:MM to minutes-from-midnight for arithmetic
  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const newStart = toMin(newBlockStart);
  const newEnd   = toMin(newBlockEnd);

  for (const appt of existing) {
    const block = appt.timeBlockId;
    if (!block?.startTime || !block?.endTime) continue; // skip if block missing
    const eStart = toMin(block.startTime);
    const eEnd   = toMin(block.endTime);
    // Standard overlap: newStart < eEnd AND newEnd > eStart
    if (newStart < eEnd && newEnd > eStart) return appt;
  }

  return null; // no overlap
};

/** Return true if [time, time+duration) overlaps any appointment in the list. */
function _overlapsAny(time, duration, appointments) {
  const [newH, newM] = time.split(':').map(Number);
  const newStart = newH * 60 + newM;
  const newEnd   = newStart + duration;

  for (const appt of appointments) {
    // Block-based appointments have no appointmentTime — skip overlap check for them
    if (!appt.appointmentTime) continue;
    const [eH, eM] = appt.appointmentTime.split(':').map(Number);
    const eStart = eH * 60 + eM;
    const eEnd   = eStart + appt.duration;
    if (newStart < eEnd && newEnd > eStart) return true;
  }
  return false;
}

// Method to send reminder notification
appointmentSchema.methods.sendReminder = function() {
  // Implementation would use notification service
  this.notifications.reminderSent = true;
  return this.save();
};

module.exports = mongoose.model('Appointment', appointmentSchema);