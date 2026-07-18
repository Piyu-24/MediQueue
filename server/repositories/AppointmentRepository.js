// Database access for appointments

const BaseRepository = require('../core/BaseRepository');
const Appointment = require('../models/Appointment');
const Logger = require('../utils/Logger');
const { ConflictError, BusinessLogicError } = require('../utils/errors');

class AppointmentRepository extends BaseRepository {
  constructor() {
    super(Appointment, Logger.getLogger('AppointmentRepository'));
  }

  // Get a patient's appointments
  async findByPatientId(patientId, options = {}) {
    try {
      this.logger.debug('Finding appointments by patient ID', { patientId });
      
      return await this.findMany({ patient: patientId }, {
        ...options,
        populate: [
          { path: 'doctor', select: 'firstName lastName specialization' },
          { path: 'patient', select: 'firstName lastName email phone' }
        ]
      });
    } catch (error) {
      this.logger.error('Error finding appointments by patient ID:', error);
      throw error;
    }
  }

  // Get a doctor's appointments
  async findByDoctorId(doctorId, options = {}) {
    try {
      this.logger.debug('Finding appointments by doctor ID', { doctorId });
      
      return await this.findMany({ doctor: doctorId }, {
        ...options,
        populate: [
          { path: 'patient', select: 'firstName lastName email phone' },
          { path: 'doctor', select: 'firstName lastName specialization' }
        ]
      });
    } catch (error) {
      this.logger.error('Error finding appointments by doctor ID:', error);
      throw error;
    }
  }

  // Get appointments within a date range
  async findByDateRange(startDate, endDate, filters = {}, options = {}) {
    try {
      this.logger.debug('Finding appointments by date range', { startDate, endDate });
      
      const query = {
        ...filters,
        appointmentDate: {
          $gte: startDate,
          $lte: endDate
        }
      };
      
      return await this.findMany(query, {
        ...options,
        populate: [
          { path: 'patient', select: 'firstName lastName email phone' },
          { path: 'doctor', select: 'firstName lastName specialization' }
        ]
      });
    } catch (error) {
      this.logger.error('Error finding appointments by date range:', error);
      throw error;
    }
  }

  // Get appointments with a given status
  async findByStatus(status, options = {}) {
    try {
      this.logger.debug('Finding appointments by status', { status });
      
      return await this.findMany({ status }, {
        ...options,
        populate: [
          { path: 'patient', select: 'firstName lastName email phone' },
          { path: 'doctor', select: 'firstName lastName specialization' }
        ]
      });
    } catch (error) {
      this.logger.error('Error finding appointments by status:', error);
      throw error;
    }
  }

  // Create an appointment after checking for conflicts
  async createAppointment(appointmentData, options = {}) {
    try {
      this.logger.debug('Creating new appointment', {
        doctorId: appointmentData.doctor,
        appointmentDate: appointmentData.appointmentDate
      });

      // Check for scheduling conflicts
      await this.checkSchedulingConflicts(
        appointmentData.doctor,
        appointmentData.appointmentDate,
        appointmentData.duration || 30
      );
      
      return await this.create(appointmentData, options);
    } catch (error) {
      this.logger.error('Error creating appointment:', error);
      throw error;
    }
  }

  // Update an appointment's status
  async updateStatus(appointmentId, status, options = {}) {
    try {
      this.logger.debug('Updating appointment status', { appointmentId, status });
      
      const updateData = { 
        status,
        updatedAt: new Date()
      };
      
      // Add completion timestamp for completed appointments
      if (status === 'completed') {
        updateData.completedAt = new Date();
      }
      
      return await this.updateById(appointmentId, updateData, options);
    } catch (error) {
      this.logger.error('Error updating appointment status:', error);
      throw error;
    }
  }

  // Reschedule an appointment to a new date
  async reschedule(appointmentId, newDate, duration = 30, options = {}) {
    try {
      this.logger.debug('Rescheduling appointment', { appointmentId, newDate });
      
      // Load it so we know which doctor to check
      const appointment = await this.findById(appointmentId);
      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }
      
      // Check for conflicts with new date
      await this.checkSchedulingConflicts(appointment.doctor, newDate, duration, appointmentId);
      
      return await this.updateById(appointmentId, {
        appointmentDate: newDate,
        duration,
        status: 'rescheduled',
        updatedAt: new Date()
      }, options);
    } catch (error) {
      this.logger.error('Error rescheduling appointment:', error);
      throw error;
    }
  }

  // Get a doctor's appointments for today
  async getTodayAppointments(doctorId, options = {}) {
    try {
      this.logger.debug('Getting today\'s appointments', { doctorId });
      
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      
      const result = await this.findByDateRange(startOfDay, endOfDay, { doctor: doctorId }, {
        ...options,
        sort: { appointmentDate: 1 }
      });
      
      return result.data;
    } catch (error) {
      this.logger.error('Error getting today\'s appointments:', error);
      throw error;
    }
  }

  // Get a patient's upcoming appointments
  async getUpcomingAppointments(patientId, limit = 10, options = {}) {
    try {
      this.logger.debug('Getting upcoming appointments', { patientId, limit });
      
      const now = new Date();
      const result = await this.findMany({
        patient: patientId,
        appointmentDate: { $gte: now },
        status: { $in: ['scheduled', 'confirmed'] }
      }, {
        ...options,
        limit,
        sort: { appointmentDate: 1 },
        populate: [{ path: 'doctor', select: 'firstName lastName specialization' }]
      });
      
      return result.data;
    } catch (error) {
      this.logger.error('Error getting upcoming appointments:', error);
      throw error;
    }
  }

  // Count appointments grouped by status
  async getAppointmentStatistics(filters = {}) {
    try {
      this.logger.debug('Getting appointment statistics', { filters });
      
      const stats = await this.aggregate([
        { $match: filters },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$count' },
            statusBreakdown: {
              $push: {
                status: '$_id',
                count: '$count'
              }
            }
          }
        }
      ]);
      
      return stats[0] || { total: 0, statusBreakdown: [] };
    } catch (error) {
      this.logger.error('Error getting appointment statistics:', error);
      throw error;
    }
  }

  // Throw if the doctor already has an appointment overlapping this time
  async checkSchedulingConflicts(doctorId, appointmentDate, duration, excludeAppointmentId = null) {
    try {
      const startTime = new Date(appointmentDate);
      const endTime = new Date(startTime.getTime() + (duration * 60000));
      
      const query = {
        doctor: doctorId,
        status: { $in: ['scheduled', 'confirmed'] },
        $or: [
          {
            appointmentDate: {
              $gte: startTime,
              $lt: endTime
            }
          },
          {
            $and: [
              { appointmentDate: { $lte: startTime } },
              {
                $expr: {
                  $gte: [
                    { $add: ['$appointmentDate', { $multiply: ['$duration', 60000] }] },
                    startTime
                  ]
                }
              }
            ]
          }
        ]
      };
      
      if (excludeAppointmentId) {
        query._id = { $ne: excludeAppointmentId };
      }
      
      const conflictingAppointment = await this.findOne(query);
      
      if (conflictingAppointment) {
        throw new ConflictError('Doctor is not available at the requested time');
      }
    } catch (error) {
      if (error instanceof ConflictError) {
        throw error;
      }
      this.logger.error('Error checking scheduling conflicts:', error);
      throw new BusinessLogicError('Unable to verify appointment availability');
    }
  }

  // Get a patient's past appointments (newest first)
  async getAppointmentHistory(patientId, options = {}) {
    try {
      this.logger.debug('Getting appointment history', { patientId });
      
      return await this.findMany({ patient: patientId }, {
        ...options,
        sort: { appointmentDate: -1 },
        populate: [{ path: 'doctor', select: 'firstName lastName specialization' }]
      });
    } catch (error) {
      this.logger.error('Error getting appointment history:', error);
      throw error;
    }
  }

  // Cancel an appointment
  async cancelAppointment(appointmentId, cancellationReason, options = {}) {
    try {
      this.logger.debug('Cancelling appointment', { appointmentId, cancellationReason });
      
      return await this.updateById(appointmentId, {
        status: 'cancelled',
        cancellationReason,
        cancelledAt: new Date(),
        updatedAt: new Date()
      }, options);
    } catch (error) {
      this.logger.error('Error cancelling appointment:', error);
      throw error;
    }
  }
}

module.exports = AppointmentRepository;
