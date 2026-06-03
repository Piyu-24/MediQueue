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
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Doctor is required']
  },

  // Appointment Details
  appointmentDate: {
    type: Date,
    required: [true, 'Appointment date is required']
  },
  appointmentTime: {
    type: String,
    required: [true, 'Appointment time is required'],
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
      'scheduled',          // booked, not yet checked in
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

// Compound index for doctor availability checking
appointmentSchema.index({
  doctor: 1,
  appointmentDate: 1,
  appointmentTime: 1,
  status: 1
});

// Partial unique index — prevents same patient booking same doctor/date/time
// while any active appointment exists. Cancelled/completed/no-show are excluded.
appointmentSchema.index(
  { patient: 1, doctor: 1, appointmentDate: 1, appointmentTime: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          'scheduled', 'confirmed', 'checked_in', 'in_queue',
          'in_consultation', 'in-progress', 'late', 'delayed', 'skipped'
        ]
      }
    },
    name: 'unique_active_patient_doctor_slot'
  }
);

// Pre-save middleware — only enforce future-date rule on NEW appointments
appointmentSchema.pre('save', function(next) {
  if (this.isNew) {
    const appointmentDateTime = this.appointmentDateTime;
    if (appointmentDateTime && appointmentDateTime <= new Date()) {
      return next(new Error('Appointment must be scheduled for a future date and time'));
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

// All statuses that occupy a slot (conflict-causing)
const ACTIVE_CONFLICT_STATUSES = [
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

// Static method to find booked slots for a doctor (availability display)
appointmentSchema.statics.findAvailableSlots = async function(doctorId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.find({
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ACTIVE_CONFLICT_STATUSES }
  }).select('appointmentTime duration');
};

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

/** Return true if [time, time+duration) overlaps any appointment in the list. */
function _overlapsAny(time, duration, appointments) {
  const [newH, newM] = time.split(':').map(Number);
  const newStart = newH * 60 + newM;
  const newEnd   = newStart + duration;

  for (const appt of appointments) {
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