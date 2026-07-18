const mongoose = require('mongoose');

// A hospital department. Patients book by department for General OPD,
// and tokens/capacity policies are scoped per department too.
const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Department name is required'],
    trim: true,
    maxlength: [100, 'Department name cannot exceed 100 characters']
  },
  // Short code used in displays and reports (e.g. OPD, CARDIO, ORTHO)
  code: {
    type: String,
    required: [true, 'Department code is required'],
    uppercase: true,
    trim: true,
    maxlength: [10, 'Department code cannot exceed 10 characters'],
    match: [/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, hyphens or underscores']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  // Default baseline for ETA calculations when no session history is available
  averageConsultationMinutes: {
    type: Number,
    default: 10,
    min: [1, 'Average consultation must be at least 1 minute']
  },
  // true for OPD (or any dept with multiple consultation rooms)
  // drives receptionist room-selection logic at check-in
  hasMultipleRooms: {
    type: Boolean,
    default: false
  },

  // Floor/building location (informational)
  location: {
    floor: String,
    building: String,
    wing: String
  },
  // Contact / operational
  contactPhone: {
    type: String,
    trim: true
  },
  operatingHours: {
    start: { type: String, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM'] },
    end:   { type: String, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM'] }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

departmentSchema.index({ code: 1 }, { unique: true });
departmentSchema.index({ status: 1 });
departmentSchema.index({ name: 'text' });

module.exports = mongoose.model('Department', departmentSchema);
