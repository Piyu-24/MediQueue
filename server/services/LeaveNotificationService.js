const mongoose = require('mongoose');
const DoctorSlot = require('../models/DoctorSlot');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const Room = require('../models/Room');
const User = require('../models/User');

// Notify every admin when a doctor is on leave or returns to duty.
const notifyAdminsAboutRooms = async (doctorId, doctorUser, io, { returning = false, dateLabel = '' } = {}) => {
  const rooms = await Room.find({ assignedDoctors: doctorId })
    .select('roomNumber displayName');

  const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
  if (admins.length === 0) return;

  const doctorName = `Dr. ${doctorUser.firstName || ''} ${doctorUser.lastName || ''}`.trim();
  const roomList = rooms.map((r) => r.roomNumber).join(', ');
  
  const title = returning
    ? 'Doctor available again – review rooms'
    : (rooms.length > 0 ? 'Room needs a replacement doctor' : 'Doctor on leave alert');
    
  const message = returning
    ? `${doctorName} is available again${dateLabel ? ` (${dateLabel})` : ''}.${rooms.length > 0 ? ` Review the doctor assignments for room(s) ${roomList}.` : ''}`
    : (rooms.length > 0
        ? `${doctorName} is on leave${dateLabel ? ` (${dateLabel})` : ''}. Room(s) ${roomList} need a replacement doctor before patients can be checked in.`
        : `${doctorName} is on leave${dateLabel ? ` (${dateLabel})` : ''}.`);

  for (const admin of admins) {
    try {
      const newNotif = await Notification.create({
        recipient: admin._id,
        type: 'system',
        title,
        message,
        metadata: {
          doctorId: doctorId.toString(),
          rooms: rooms.map((r) => r._id.toString()),
          returning
        }
      });

      if (io) {
        const payload = {
          _id: newNotif._id.toString(),
          type: 'system',
          title,
          message,
          metadata: {
            doctorId: doctorId.toString(),
            rooms: rooms.map((r) => r._id.toString()),
            returning
          },
          createdAt: newNotif.createdAt || new Date().toISOString()
        };

        const adminRoomId = admin._id.toString();
        io.to(adminRoomId).emit('notification', payload);
      }
    } catch (err) {
      console.error('Admin room notification failed (non-fatal):', err.message);
    }
  }
};

const DEFAULT_STATUSES = ['scheduled', 'confirmed'];

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const isTimeOverlap = (time, startTime, endTime) => {
  const t = toMinutes(time);
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  return t >= start && t < end;
};

const normalizeDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const buildDateList = (startDate, endDate) => {
  const dates = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

class LeaveNotificationService {
  async processLeave(doctorId, leaveData, doctorUser, io, options = {}) {
    const { dryRun = false, requestInfo } = options;

    const leaveId = leaveData.leaveId || new mongoose.Types.ObjectId().toString();
    const leaveType = leaveData.leaveType || 'FULL_DAY';
    const reason = leaveData.reason || 'OTHER';
    const description = leaveData.description || '';

    const { start, end } = normalizeDateRange(leaveData.startDate, leaveData.endDate);

    const appointmentQuery = {
      doctor: doctorId,
      status: { $in: DEFAULT_STATUSES },
      appointmentDate: { $gte: start, $lte: end }
    };

    const rawAppointments = await Appointment.find(appointmentQuery)
      .populate('patient', 'firstName lastName email phone')
      .populate('doctor', 'firstName lastName specialization');

    const now = new Date();
    const appointments = rawAppointments.filter((appointment) => {
      // OPD block appointments have no exact time - include them for full-day leave only
      const appointmentDateTime = new Date(appointment.appointmentDate);
      if (appointment.appointmentTime) {
        const [hours, minutes] = appointment.appointmentTime.split(':').map(Number);
        appointmentDateTime.setHours(hours, minutes, 0, 0);
      } else {
        appointmentDateTime.setHours(23, 59, 59, 999);
      }

      if (appointmentDateTime < now) return false;

      if (leaveType === 'PARTIAL_DAY') {
        if (!leaveData.startTime || !leaveData.endTime || !appointment.appointmentTime) return false;
        return isTimeOverlap(appointment.appointmentTime, leaveData.startTime, leaveData.endTime);
      }

      return true;
    });

    if (dryRun) {
      return {
        leaveId,
        affectedCount: appointments.length,
        affectedAppointments: appointments.map((appointment) => appointment._id)
      };
    }

    let session = null;
    const allowTransactions = process.env.NODE_ENV !== 'test';
    const notifiedPatients = [];

    try {
      if (allowTransactions) {
        try {
          session = await mongoose.startSession();
          session.startTransaction();
        } catch (txErr) {
          console.warn('Transactions unavailable, proceeding without session:', txErr.message);
          session = null;
        }
      }

      const datesToBlock = buildDateList(start, end);
      const blockedSlots = [];

      for (const date of datesToBlock) {
        const startTime = leaveType === 'PARTIAL_DAY' ? leaveData.startTime : '00:00';
        const endTime = leaveType === 'PARTIAL_DAY' ? leaveData.endTime : '23:59';

        const update = {
          status: 'BLOCKED',
          slotType: 'BLOCKED',
          blockingInfo: {
            reason,
            description,
            blockedAt: new Date(),
            blockedBy: doctorId,
            leaveId
          },
          lastModifiedBy: doctorId
        };

        const findUpdateOpts = session ? { session } : {};

        const slot = await DoctorSlot.findOneAndUpdate(
          {
            doctor: doctorId,
            date,
            startTime,
            endTime
          },
          {
            $set: update,
            $setOnInsert: {
              doctor: doctorId,
              date,
              startTime,
              endTime,
              duration: leaveType === 'PARTIAL_DAY' ? (toMinutes(endTime) - toMinutes(startTime)) : 24 * 60,
              createdBy: doctorId
            }
          },
          { upsert: true, new: true, ...findUpdateOpts }
        );

        blockedSlots.push(slot);
      }

      for (const appointment of appointments) {
        const previousStatus = appointment.status;
        appointment.status = 'doctor-unavailable';
        appointment.leaveInfo = {
          leaveId,
          markedAt: new Date(),
          reason,
          previousStatus
        };
        await appointment.save(session ? { session } : undefined);

        const notification = await Notification.createLeaveNotification(
          appointment.patient._id,
          appointment,
          doctorUser,
          { reason, leaveType }
        );

        notifiedPatients.push({
          patientId: appointment.patient._id,
          notificationId: notification._id
        });

        if (io) {
          io.to(appointment.patient._id.toString()).emit('appointment:doctor-unavailable', {
            appointmentId: appointment._id,
            doctorId: doctorUser._id,
            doctorName: `Dr. ${doctorUser.firstName} ${doctorUser.lastName}`,
            appointmentDate: appointment.appointmentDate,
            appointmentTime: appointment.appointmentTime,
            reason
          });
        }
      }

        if (requestInfo) {
        await AuditLog.createLog({
          userId: doctorId,
          userRole: 'doctor',
          action: 'DOCTOR_LEAVE_SUBMITTED',
          resourceType: 'DoctorSlot',
          resourceId: doctorId,
          ipAddress: requestInfo.ipAddress,
          userAgent: requestInfo.userAgent,
          description: `Doctor submitted leave (${leaveType}) from ${leaveData.startDate} to ${leaveData.endDate || leaveData.startDate}`,
          metadata: {
            leaveId,
            leaveType,
            reason,
            blockedSlots: blockedSlots.length,
            affectedAppointments: appointments.length
          }
        });

        if (appointments.length > 0) {
          await AuditLog.createLog({
            userId: doctorId,
            userRole: 'doctor',
            action: 'PATIENT_NOTIFIED_LEAVE',
            resourceType: 'Appointment',
            resourceId: doctorId,
            ipAddress: requestInfo.ipAddress,
            userAgent: requestInfo.userAgent,
            description: `Notified ${appointments.length} patient(s) about doctor leave`,
            metadata: {
              leaveId,
              notifiedCount: appointments.length
            }
          });
        }
      }

      if (session) {
        try {
          await session.commitTransaction();
        } catch (commitErr) {
          if (commitErr && commitErr.message && commitErr.message.includes('Transaction numbers are only allowed')) {
            console.warn('Commit skipped: transactions not supported in this MongoDB deployment');
          } else {
            throw commitErr;
          }
        }
      }

      // Alert admins that this doctor's OPD rooms need a replacement doctor.
      try {
        const dateLabel = leaveData.endDate && leaveData.endDate !== leaveData.startDate
          ? `${leaveData.startDate} – ${leaveData.endDate}`
          : leaveData.startDate;
        await notifyAdminsAboutRooms(doctorId, doctorUser, io, { returning: false, dateLabel });
      } catch (notifyErr) {
        console.error('Admin room alert failed (non-fatal):', notifyErr.message);
      }

      return {
        leaveId,
        affectedCount: appointments.length,
        notifiedPatients
      };
    } catch (error) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch (abortErr) {
          console.warn('Abort transaction failed or not supported:', abortErr.message || abortErr);
        }
      }
      throw error;
    } finally {
      if (session) {
        try { session.endSession(); } catch (e) { /* ignore */ }
      }
    }
  }

  async cancelLeave(doctorId, slotId, requestInfo, io = null) {
    const slot = await DoctorSlot.findOne({ _id: slotId, doctor: doctorId, status: 'BLOCKED' });
    if (!slot) {
      throw new Error('Leave slot not found');
    }

    const leaveId = slot.blockingInfo?.leaveId;

    await DoctorSlot.deleteOne({ _id: slotId });

    // Alert admins that this doctor is available again so room assignments can
    // be reviewed. Runs even if there were no doctor-unavailable appointments.
    try {
      const doctorUser = await User.findById(doctorId).select('firstName lastName');
      if (doctorUser) {
        await notifyAdminsAboutRooms(doctorId, doctorUser, io, { returning: true });
      }
    } catch (notifyErr) {
      console.error('Admin room return-alert failed (non-fatal):', notifyErr.message);
    }

    if (!leaveId) {
      return { restored: 0 };
    }

    const affected = await Appointment.find({
      doctor: doctorId,
      status: 'doctor-unavailable',
      'leaveInfo.leaveId': leaveId
    });

    let restored = 0;

    for (const appointment of affected) {
      appointment.status = appointment.leaveInfo?.previousStatus || 'scheduled';
      appointment.leaveInfo = undefined;
      await appointment.save();
      restored += 1;
    }

    if (requestInfo) {
      await AuditLog.createLog({
        userId: doctorId,
        userRole: 'doctor',
        action: 'UNBLOCK_SLOTS',
        resourceType: 'DoctorSlot',
        resourceId: doctorId,
        ipAddress: requestInfo.ipAddress,
        userAgent: requestInfo.userAgent,
        description: `Doctor cancelled leave slot ${slotId}`,
        metadata: {
          leaveId,
          restoredAppointments: restored
        }
      });
    }

    return { restored };
  }

  async listLeaves(doctorId, startDate, endDate) {
    const query = {
      doctor: doctorId,
      status: 'BLOCKED',
      slotType: 'BLOCKED'
    };

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query.date = { $gte: start };
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.date = { ...(query.date || {}), $lte: end };
    }

    return DoctorSlot.find(query).sort({ date: 1, startTime: 1 });
  }
}

module.exports = new LeaveNotificationService();
