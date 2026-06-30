const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomNumber: {
    type: String,
    required: [true, 'Room number is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  displayName: {
    type: String,
    required: [true, 'Display name is required'],
    trim: true,
    maxlength: [100, 'Display name cannot exceed 100 characters']
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department is required'],
    index: true
  },
  status: {
    type: String,
    enum: ['available', 'unavailable'],
    default: 'available'
  },
  // true  = room availability mirrors parent department status (non-OPD single rooms)
  // false = admin controls room status independently (OPD multi-room)
  isAutoManaged: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

roomSchema.index({ department: 1, status: 1 });

module.exports = mongoose.model('Room', roomSchema);
