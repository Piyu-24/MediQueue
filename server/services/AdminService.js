// Business logic for admin dashboard and reports

const BaseService = require('../core/BaseService');
const Logger = require('../utils/Logger');

// Admin logic, built on top of BaseService
class AdminService extends BaseService {
  constructor(userRepository, appointmentRepository) {
    super(null, Logger.getLogger('AdminService'));
    this.userRepository = userRepository;
    this.appointmentRepository = appointmentRepository;
  }

  // Get the stats for the admin dashboard
  async getDashboardOverview() {
    try {
      this.logger.info('Fetching dashboard overview statistics');

      // Get current date for today's calculations
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

      // Execute parallel queries for better performance
      const [
        totalUsers,
        totalDoctors,
        todayAppointments,
        pendingAppointments,
        completedAppointments,
        recentAppointments
      ] = await Promise.all([
        this.userRepository.count({ role: 'patient' }),
        this.userRepository.count({ role: 'doctor' }),
        this.appointmentRepository.count({
          appointmentDate: { $gte: startOfDay, $lt: endOfDay }
        }),
        this.appointmentRepository.count({
          status: { $in: ['scheduled', 'confirmed'] }
        }),
        this.appointmentRepository.count({ status: 'completed' }),
        this.appointmentRepository.findMany(
          {},
          {
            limit: 5,
            sort: { createdAt: -1 },
            populate: [
              { path: 'patient', select: 'firstName lastName email' },
              { path: 'doctor', select: 'firstName lastName specialization' }
            ]
          }
        )
      ]);

      const dashboardData = {
        totalUsers,
        totalDoctors,
        todayAppointments,
        pendingAppointments,
        completedAppointments,
        recentAppointments: recentAppointments.data,
        message: 'Dashboard overview generated'
      };

      this.logger.info('Dashboard overview statistics fetched successfully', {
        totalUsers,
        totalDoctors,
        todayAppointments
      });

      // Emit business event for audit
      this.emit('dashboardAccessed', { statistics: dashboardData });

      return dashboardData;
    } catch (error) {
      this.logger.error('Error fetching dashboard overview:', error);
      throw this.handleServiceError(error);
    }
  }

  // Build the patient visit report
  async generatePatientVisitReport(filters = {}) {
    try {
      this.logger.info('Generating patient visit report', { filters });

      const { startDate, endDate, department, status } = filters;

      // Build query filters
      const query = {};
      if (startDate && endDate) {
        query.appointmentDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }
      if (department) query.department = department;
      if (status) query.status = status;

      // Fetch appointments with populated data
      const appointmentsResult = await this.appointmentRepository.findMany(query, {
        sort: { appointmentDate: -1 },
        populate: [
          { path: 'patient', select: 'firstName lastName email phone' },
          { path: 'doctor', select: 'firstName lastName specialization' }
        ]
      });

      const appointments = appointmentsResult.data;

      // Generate analytics
      const analytics = this.generateVisitAnalytics(appointments);

      const reportData = {
        appointments,
        analytics,
        summary: {
          totalRecords: appointments.length,
          dateRange: { startDate, endDate },
          filters: { department, status }
        }
      };

      this.logger.info('Patient visit report generated successfully', {
        totalRecords: appointments.length
      });

      // Emit business event
      this.emit('reportGenerated', {
        type: 'patient-visit',
        recordCount: appointments.length,
        filters
      });

      return reportData;
    } catch (error) {
      this.logger.error('Error generating patient visit report:', error);
      throw this.handleServiceError(error);
    }
  }

  // Build the staff utilization report
  async generateStaffUtilizationReport(filters = {}) {
    try {
      this.logger.info('Generating staff utilization report', { filters });

      const { startDate, endDate, department } = filters;

      // Build queries
      const appointmentQuery = {};
      if (startDate && endDate) {
        appointmentQuery.appointmentDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }
      if (department) appointmentQuery.department = department;

      const doctorQuery = { role: 'doctor' };
      if (department) doctorQuery.specialization = department;

      // Fetch data in parallel
      const [doctorsResult, appointmentsResult] = await Promise.all([
        this.userRepository.findMany(doctorQuery),
        this.appointmentRepository.findMany(appointmentQuery, {
          populate: [{ path: 'doctor', select: 'firstName lastName specialization' }]
        })
      ]);

      const doctors = doctorsResult.data;
      const appointments = appointmentsResult.data;

      // Calculate utilization metrics
      const staffUtilization = this.calculateStaffUtilization(doctors, appointments);
      const summary = this.calculateUtilizationSummary(staffUtilization);

      const reportData = {
        staffUtilization,
        summary: {
          ...summary,
          totalRecords: staffUtilization.length,
          dateRange: { startDate, endDate },
          filters: { department }
        }
      };

      this.logger.info('Staff utilization report generated successfully', {
        totalStaff: doctors.length
      });

      // Emit business event
      this.emit('reportGenerated', {
        type: 'staff-utilization',
        staffCount: doctors.length,
        filters
      });

      return reportData;
    } catch (error) {
      this.logger.error('Error generating staff utilization report:', error);
      throw this.handleServiceError(error);
    }
  }

  // Break down visits by day, department, status and doctor
  generateVisitAnalytics(appointments) {
    const analytics = {
      totalVisits: appointments.length,
      dailyBreakdown: {},
      departmentBreakdown: {},
      statusBreakdown: {},
      doctorBreakdown: {}
    };

    appointments.forEach(appointment => {
      // Daily breakdown
      const date = appointment.appointmentDate.toISOString().split('T')[0];
      analytics.dailyBreakdown[date] = (analytics.dailyBreakdown[date] || 0) + 1;

      // Department breakdown
      const dept = appointment.department || 'General';
      analytics.departmentBreakdown[dept] = (analytics.departmentBreakdown[dept] || 0) + 1;

      // Status breakdown
      analytics.statusBreakdown[appointment.status] = 
        (analytics.statusBreakdown[appointment.status] || 0) + 1;

      // Doctor breakdown
      if (appointment.doctor) {
        const doctorName = `${appointment.doctor.firstName} ${appointment.doctor.lastName}`;
        analytics.doctorBreakdown[doctorName] = 
          (analytics.doctorBreakdown[doctorName] || 0) + 1;
      }
    });

    return analytics;
  }

  // Work out how busy each doctor was
  calculateStaffUtilization(doctors, appointments) {
    return doctors.map(doctor => {
      const doctorAppointments = appointments.filter(apt => 
        apt.doctor && apt.doctor._id.toString() === doctor._id.toString()
      );

      const completedAppointments = doctorAppointments.filter(apt => 
        apt.status === 'completed'
      );

      const completionRate = doctorAppointments.length > 0 
        ? Math.round((completedAppointments.length / doctorAppointments.length) * 100)
        : 0;

      const utilizationRate = Math.min(
        Math.round((doctorAppointments.length / 40) * 100), 
        100
      ); // Assuming 40 appointments per period is 100%

      return {
        doctorId: doctor._id,
        name: `${doctor.firstName} ${doctor.lastName}`,
        specialization: doctor.specialization,
        totalAppointments: doctorAppointments.length,
        completedAppointments: completedAppointments.length,
        completionRate,
        utilizationRate
      };
    });
  }

  // Average the utilization numbers across all staff
  calculateUtilizationSummary(staffUtilization) {
    if (staffUtilization.length === 0) {
      return {
        totalStaff: 0,
        averageUtilization: 0,
        averageCompletion: 0
      };
    }

    const totalStaff = staffUtilization.length;
    const averageUtilization = Math.round(
      staffUtilization.reduce((sum, staff) => sum + staff.utilizationRate, 0) / totalStaff
    );
    const averageCompletion = Math.round(
      staffUtilization.reduce((sum, staff) => sum + staff.completionRate, 0) / totalStaff
    );

    return {
      totalStaff,
      averageUtilization,
      averageCompletion
    };
  }




  getResourceName() {
    return 'Admin';
  }
}

module.exports = AdminService;
