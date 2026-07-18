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
    // Optional now - block bookings use timeBlockId instead. Old bookings still set this.
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
      'booked',             // token issued at booking; patient not yet checked in
      // old statuses kept for backward compatibility
      'scheduled',          // old initial status (exact-time bookings)
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

  // Block booking fields.
  // departmentId is used by new bookings; old ones just keep the `department` string.
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true,
    sparse: true
  },
  // Time block picked at booking (used instead of an exact appointmentTime)
  timeBlockId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeBlock',
    default: null,
    index: true,
    sparse: true
  },

  // Token given at booking, e.g. "A014"
  appointmentToken: {
    type: String,
    default: null,
    uppercase: true,
    trim: true,
    index: true,
    sparse: true
  },
  // The number part of the token
  tokenNumber: {
    type: Number,
    default: null
  },
  // Token prefix (always 'A' at booking)
  tokenPrefix: {
    type: String,
    enum: ['A', 'W', 'E'],
    default: 'A'
  },

  // How it was booked:
  // 'general_opd' - picked a department/block, doctor assigned at check-in
  // 'specialist'  - picked a specific doctor
  bookingType: {
    type: String,
    enum: ['general_opd', 'specialist'],
    default: 'general_opd'
  },

  // Consultation room, set at check-in
  assignedRoom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    default: null,
    index: true,
    sparse: true
  },

  // When the patient should arrive (block start time minus an offset)
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

// Indexes

appointmentSchema.index({ patient: 1, appointmentDate: 1 });
appointmentSchema.index({ doctor: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1, appointmentDate: 1 });
appointmentSchema.index({ appointmentDate: 1, appointmentTime: 1 });
// indexes for block bookings
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

// Stops the same patient booking the same doctor/date/time while an active
// appointment already exists (cancelled/completed/no-show don't count)
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

// Only check the future-date rule when creating a new appointment
appointmentSchema.pre('save', function(next) {
  if (this.isNew) {
    // Block bookings store the block's start time, which is "in the past" once the
    // session starts, so for those we only check the date is today or later.
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
      // Exact-time booking - the full date and time must be in the future
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

// Statuses that take up a slot (used for conflict checks).
// 'booked' is included so a new booking clashes with an already-booked one.
const ACTIVE_CONFLICT_STATUSES = [
  'booked',
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

// Active statuses for patient booking-conflict checks (includes old aliases too)
const ACTIVE_BOOKING_STATUSES = [
  'booked',
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

// Stops the same patient booking the same time block twice
// (appointments without a timeBlockId are skipped)
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

// Stops the same patient having two active appointments for the same department
// on the same day. Only applies to block bookings that have a departmentId.
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

// True if the doctor already has an appointment overlapping this slot
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

// True if the patient already has an appointment overlapping this slot
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

// True if the patient already booked this same time block
appointmentSchema.statics.hasOPDDuplicate = async function(patientId, timeBlockId, excludeId = null) {
  const query = {
    patient: patientId,
    timeBlockId,
    status: { $in: ACTIVE_CONFLICT_STATUSES }
  };
  if (excludeId) query._id = { $ne: excludeId };
  return (await this.countDocuments(query)) > 0;
};

// Rule 1: true if the patient already has an appointment for this department today
appointmentSchema.statics.hasActiveSameDeptDayConflict = async function(
  patientId,
  departmentId,
  appointmentDate,
  excludeId = null
) {
  // Start and end of the day
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

// Rule 2: returns a clashing appointment if this patient's block overlaps one in
// another department on the same day (same-department is handled by Rule 1 above)
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

  // Get this patient's active appointments today in other departments that have a block
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

  // Turn HH:MM into minutes so we can compare
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
    // Two ranges overlap when newStart < eEnd and newEnd > eStart
    if (newStart < eEnd && newEnd > eStart) return appt;
  }

  return null; // no overlap
};

// True if [time, time+duration) overlaps any appointment in the list
function _overlapsAny(time, duration, appointments) {
  const [newH, newM] = time.split(':').map(Number);
  const newStart = newH * 60 + newM;
  const newEnd   = newStart + duration;

  for (const appt of appointments) {
    // Block appointments have no exact time, so skip them
    if (!appt.appointmentTime) continue;
    const [eH, eM] = appt.appointmentTime.split(':').map(Number);
    const eStart = eH * 60 + eM;
    const eEnd   = eStart + appt.duration;
    if (newStart < eEnd && newEnd > eStart) return true;
  }
  return false;
}

// Mark the reminder as sent
appointmentSchema.methods.sendReminder = function() {
  this.notifications.reminderSent = true;
  return this.save();
};

module.exports = mongoose.model('Appointment', appointmentSchema);