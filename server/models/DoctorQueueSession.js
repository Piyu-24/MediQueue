const mongoose = require('mongoose');

// One queue session per doctor per day (active/paused/ended).
// Created automatically when the first patient checks in for that doctor.
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

  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'ended'],
    default: 'active'
  },

  // Timestamps
  startedAt: { type: Date, default: Date.now },
  pausedAt: { type: Date, default: null },
  resumedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null }, // set when the session is closed

  pauseReason: {
    type: String,
    maxlength: 200,
    default: null
  },

  // The queue entry currently with the doctor
  currentQueueEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QueueEntry',
    default: null
  },

  // Rolling average consultation time, updated after each one finishes
  avgConsultationMinutes: {
    type: Number,
    default: 10
  },
  consultationsCompleted: {
    type: Number,
    default: 0
  },

  // Shown to patients when the queue is paused
  delayMessage: {
    type: String,
    maxlength: 300,
    default: null
  },

  // Daily summary, filled in when the session is closed
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

// Get the session for a doctor/date, creating it if it doesn't exist
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

// Update the rolling average consultation time after one finishes
doctorQueueSessionSchema.methods.recordConsultation = async function (durationMinutes) {
  const n = this.consultationsCompleted;
  this.avgConsultationMinutes = Math.round(
    (this.avgConsultationMinutes * n + durationMinutes) / (n + 1)
  );
  this.consultationsCompleted += 1;
  await this.save();
};

module.exports = mongoose.model('DoctorQueueSession', doctorQueueSessionSchema);
