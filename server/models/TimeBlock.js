const mongoose = require('mongoose');

/**
 * TimeBlock — a discrete booking session within a department/doctor's day.
 *
 * Replaces the exact appointmentTime (HH:MM) slot model for General OPD.
 * Patients select a time block (e.g. 9:00–10:00) rather than an exact minute.
 *
 * Capacity model:
 *   totalCapacity = numberOfDoctors × estimatedConsultationsPerDoctor
 *   appointmentCapacity  = floor(totalCapacity × appointmentCapacityPct / 100)
 *   walkInCapacity       = floor(totalCapacity × walkInCapacityPct / 100)
 *   emergencyBuffer      = explicit count
 *   operationalBuffer    = remainder
 *
 * Only appointmentCapacity slots are exposed to online booking.
 * walkInCapacity is reserved for reception-managed walk-ins.
 * emergencyBuffer is hidden from normal booking.
 *
 * Token scope: A and W tokens share a single numeric sequence per
 * (departmentId, date, timeBlockId). E tokens use a separate sequence.
 */
const timeBlockSchema = new mongoose.Schema({
  // ── Scope ─────────────────────────────────────────────────────────────────────
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department is required'],
    index: true
  },
  // doctorId: null = General OPD block (any doctor in dept)
  // doctorId: set = Specialist block (specific doctor)
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },

  // ── Timing ────────────────────────────────────────────────────────────────────
  date: {
    type: String,
    required: [true, 'Date is required'],
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'],
    index: true
  },
  startTime: {
    type: String,
    required: [true, 'Start time is required'],
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Start time must be HH:MM']
  },
  endTime: {
    type: String,
    required: [true, 'End time is required'],
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'End time must be HH:MM']
  },
  // Friendly label shown to patients (e.g. "Morning Session", "Block 2")
  sessionName: {
    type: String,
    trim: true,
    maxlength: [60, 'Session name cannot exceed 60 characters']
  },

  // ── Capacity ──────────────────────────────────────────────────────────────────
  // Estimated total consultations (doctors × per-doctor estimate)
  totalCapacity: {
    type: Number,
    required: [true, 'Total capacity is required'],
    min: [1, 'Capacity must be at least 1']
  },
  // Slots available for online appointment booking
  appointmentCapacity: {
    type: Number,
    required: [true, 'Appointment capacity is required'],
    min: [0, 'Appointment capacity cannot be negative']
  },
  // Slots reserved for walk-ins (managed by reception)
  walkInCapacity: {
    type: Number,
    default: 0,
    min: [0, 'Walk-in capacity cannot be negative']
  },
  // Count reserved for emergencies (hidden from normal booking)
  emergencyBuffer: {
    type: Number,
    default: 2,
    min: [0, 'Emergency buffer cannot be negative']
  },
  // Remainder buffer for delays, no-shows, extended consultations
  operationalBuffer: {
    type: Number,
    default: 0,
    min: [0, 'Operational buffer cannot be negative']
  },

  // ── Live Counters (atomic increments) ────────────────────────────────────────
  bookedAppointmentCount: {
    type: Number,
    default: 0,
    min: [0, 'Booked count cannot be negative']
  },
  walkInCount: {
    type: Number,
    default: 0,
    min: [0, 'Walk-in count cannot be negative']
  },
  emergencyCount: {
    type: Number,
    default: 0,
    min: [0, 'Emergency count cannot be negative']
  },

  // ── Status ────────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['active', 'closed', 'full', 'cancelled'],
    default: 'active'
  },

  // ── Metadata ──────────────────────────────────────────────────────────────────
  // Reporting time offset: how many minutes before startTime patients should arrive
  reportingOffsetMinutes: {
    type: Number,
    default: 300,
    min: [0, 'Reporting offset cannot be negative']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [300, 'Notes cannot exceed 300 characters']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ── Virtuals ──────────────────────────────────────────────────────────────────

// Remaining appointment slots available for booking
timeBlockSchema.virtual('availableAppointmentSlots').get(function () {
  return Math.max(0, this.appointmentCapacity - this.bookedAppointmentCount);
});

// Computed reporting time string (startTime minus offset)
timeBlockSchema.virtual('reportingTime').get(function () {
  if (!this.startTime) return null;
  const [h, m] = this.startTime.split(':').map(Number);
  const totalMin = h * 60 + m - this.reportingOffsetMinutes;
  const rh = Math.floor(totalMin / 60);
  const rm = totalMin % 60;
  return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
});

// ── Indexes ───────────────────────────────────────────────────────────────────

// Main lookup for booking: given dept + date, get blocks
timeBlockSchema.index({ departmentId: 1, date: 1, startTime: 1 });
// Specialist blocks: given doctor + date
timeBlockSchema.index({ doctorId: 1, date: 1, startTime: 1 });
// Status filtering
timeBlockSchema.index({ status: 1, date: 1 });

// Unique: one block per (dept, doctor, date, startTime)
timeBlockSchema.index(
  { departmentId: 1, doctorId: 1, date: 1, startTime: 1 },
  { unique: true, name: 'unique_block_slot' }
);

// ── Static helpers ────────────────────────────────────────────────────────────

/**
 * Atomically deduct one appointment slot.
 * Returns null if the block is full; returns the updated block otherwise.
 */
timeBlockSchema.statics.deductAppointmentSlot = async function (blockId) {
  return this.findOneAndUpdate(
    {
      _id: blockId,
      status: { $in: ['active'] },
      $expr: { $lt: ['$bookedAppointmentCount', '$appointmentCapacity'] }
    },
    { $inc: { bookedAppointmentCount: 1 } },
    { new: true }
  );
};

/**
 * Atomically release one appointment slot (on cancellation/reschedule).
 */
timeBlockSchema.statics.releaseAppointmentSlot = async function (blockId) {
  return this.findOneAndUpdate(
    { _id: blockId, bookedAppointmentCount: { $gt: 0 } },
    { $inc: { bookedAppointmentCount: -1 } },
    { new: true }
  );
};

/**
 * Atomically deduct one walk-in slot.
 */
timeBlockSchema.statics.deductWalkInSlot = async function (blockId) {
  return this.findOneAndUpdate(
    {
      _id: blockId,
      $expr: { $lt: ['$walkInCount', '$walkInCapacity'] }
    },
    { $inc: { walkInCount: 1 } },
    { new: true }
  );
};

/**
 * Get blocks available for appointment booking (not full, active, future).
 */
timeBlockSchema.statics.getAvailableForBooking = async function (departmentId, date, doctorId = null) {
  const query = {
    departmentId,
    date,
    status: 'active'
  };
  if (doctorId) query.doctorId = doctorId;
  else query.doctorId = null; // General OPD blocks only

  return this.find(query)
    .sort({ startTime: 1 })
    .lean({ virtuals: true });
};

module.exports = mongoose.model('TimeBlock', timeBlockSchema);
