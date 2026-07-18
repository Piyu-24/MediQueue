// Admin HTTP routes

const BaseController = require('../core/BaseController');
const AdminService = require('../services/AdminService');
const UserRepository = require('../repositories/UserRepository');
const AppointmentRepository = require('../repositories/AppointmentRepository');
const Logger = require('../utils/Logger');

class AdminController extends BaseController {
  constructor() {
    const userRepository = new UserRepository();
    const appointmentRepository = new AppointmentRepository();

    // Pass the repositories into the service
    const adminService = new AdminService(
      userRepository,
      appointmentRepository
    );

    super(adminService, Logger.getLogger('AdminController'));
  }

  // Dashboard overview stats
  async getDashboardOverview(req, res) {
    await this.handleAsync(async (req, res) => {
      this.logAction('getDashboardOverview', req);
      
      const dashboardData = await this.service.getDashboardOverview();
      
      this.sendSuccess(res, dashboardData, 'Dashboard overview retrieved successfully');
    }, req, res);
  }

  // Patient visit report
  async getPatientVisitReport(req, res) {
    await this.handleAsync(async (req, res) => {
      this.logAction('getPatientVisitReport', req, { filters: req.query });
      
      const filters = this.buildFilters(req, ['startDate', 'endDate', 'department', 'status']);
      const reportData = await this.service.generatePatientVisitReport(filters);
      
      this.sendSuccess(res, reportData, 'Patient visit report generated successfully');
    }, req, res);
  }

  // Staff utilization report
  async getStaffUtilizationReport(req, res) {
    await this.handleAsync(async (req, res) => {
      this.logAction('getStaffUtilizationReport', req, { filters: req.query });
      
      const filters = this.buildFilters(req, ['startDate', 'endDate', 'department']);
      const reportData = await this.service.generateStaffUtilizationReport(filters);
      
      this.sendSuccess(res, reportData, 'Staff utilization report generated successfully');
    }, req, res);
  }

  getResourceName() {
    return 'Admin';
  }
}

module.exports = new AdminController();
