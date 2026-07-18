const mongoose = require('mongoose');

// QueueEntry is the live queue for a doctor on a day.
// Status flow: waiting -> ready -> in_consultation -> completed
// (plus skipped, temporarily_away, no_show, emergency_waiting).
// Tokens: A001 = appointment, W001 = walk-in, E001 = emergency.
// Zones: CURRENT (in consultation), READY (next few), WAITING_POOL (the rest), COMPLETED.
const queueEntrySchema = new mongoose.Schema({

  // Who's involved
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

  // Location
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

  // Token: tokenType is A/W/E, queueNumber is the shown token (e.g. A001),
  // sequenceNumber is the raw number
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

  // Zone and ordering
  zone: {
    type: String,
    enum: ['CURRENT', 'READY', 'WAITING_POOL', 'COMPLETED'],
    default: 'WAITING_POOL'
  },
  // Position in the queue (lower = sooner). QueueEngine recalculates this.
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

  // Status
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

  // Priority
  priority: {
    type: String,
    enum: ['normal', 'urgent'],
    default: 'normal'
  },
  priorityScore: {
    type: Number,
    default: 100  // lower = higher priority; QueueEngine sets this
  },

  // Patient type flags
  isWalkIn: { type: Boolean, default: false },
  isEmergency: { type: Boolean, default: false },
  isLate: { type: Boolean, default: false },
  // Set at check-in; QueueEngine uses it to order the queue.
  // Values: on_time, early_allowed, late_within_grace, late_outside_grace, walk_in, emergency
  arrivalStatus: {
    type: String,
    enum: ['on_time', 'early_allowed', 'late_within_grace', 'late_outside_grace', 'walk_in', 'emergency'],
    default: 'on_time'
  },

  // Appointment context
  // Scheduled time, copied at check-in (null for block bookings)
  appointmentTime: {
    type: String,
    default: null
  },
  // Original token from booking (e.g. "A014")
  appointmentToken: {
    type: String,
    default: null,
    uppercase: true
  },
  // Original token number, used to order late patients
  originalTokenNumber: {
    type: Number,
    default: null
  },

  // Time block context
  // The time block this entry belongs to (null for old exact-time entries)
  timeBlockId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeBlock',
    default: null,
    index: true,
    sparse: true
  },
  // Department id (mirrors the department string for block bookings)
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true,
    sparse: true
  },

  // For a late patient, points to whoever was in consultation when they arrived
  // (just for display/audit; the real position comes from sortOrder)
  lateInsertedAfter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QueueEntry',
    default: null
  },

  // Timestamps
  checkInTime: { type: Date, default: Date.now },
  calledTime: { type: Date },
  consultationStartTime: { type: Date },
  consultationEndTime: { type: Date },
  skippedAt: { type: Date },
  returnedAt: { type: Date },
  temporarilyAwayAt: { type: Date },
  noShowAt: { type: Date },
  // Set when marked unserved because the clinic session closed
  unservedAt: { type: Date, default: null },

  // Estimated wait
  estimatedWaitMinutes: { type: Number, default: 0 },
  avgConsultationMinutes: { type: Number, default: 10 },

  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },

  // YYYY-MM-DD string, makes daily queries fast
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

// Virtuals

queueEntrySchema.virtual('consultationDurationMinutes').get(function () {
  if (!this.consultationStartTime || !this.consultationEndTime) return null;
  return Math.round((this.consultationEndTime - this.consultationStartTime) / 60000);
});

queueEntrySchema.virtual('actualWaitMinutes').get(function () {
  if (!this.checkInTime || !this.calledTime) return null;
  return Math.round((this.calledTime - this.checkInTime) / 60000);
});

// Indexes

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

// Static methods

// Build the next token for a doctor on a date.
// Uses the highest existing sequenceNumber so it's right even with concurrent inserts.
// The unique index is the real safety net - callers should retry on a duplicate-key error.
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

// Old helper kept for backward compatibility. New code should use generateToken().
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

// Estimated wait for a new patient = number of people ahead x average consultation time
queueEntrySchema.statics.calculateETA = async function (doctorId, queueDate, avgMinutes = 10) {
  const waitingCount = await this.countDocuments({
    doctor: doctorId,
    queueDate,
    status: { $in: ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'] }
  });
  return waitingCount * avgMinutes;
};

module.exports = mongoose.model('QueueEntry', queueEntrySchema);
