const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['doctor-unavailable', 'appointment-reminder', 'system'],
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 120
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: Date,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

notificationSchema.statics.createLeaveNotification = function(recipientId, appointment, doctor, leaveData) {
  const doctorName = `Dr. ${doctor.firstName || ''} ${doctor.lastName || ''}`.trim();
  const appointmentDate = new Date(appointment.appointmentDate).toLocaleDateString('en-US');
  const appointmentTime = appointment.appointmentTime;

  return this.create({
    recipient: recipientId,
    type: 'doctor-unavailable',
    title: 'Doctor unavailable for your appointment',
    message: `${doctorName} is unavailable on ${appointmentDate} at ${appointmentTime}. Please reschedule your appointment.`,
    appointment: appointment._id,
    metadata: {
      doctorId: doctor._id,
      doctorName,
      appointmentDate,
      appointmentTime,
      leaveReason: leaveData?.reason,
      leaveType: leaveData?.leaveType
    }
  });
};

module.exports = mongoose.model('Notification', notificationSchema);
