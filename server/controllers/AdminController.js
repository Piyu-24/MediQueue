/**
 * @fileoverview Admin Controller implementing admin-specific endpoints
 * @author MediQueue Development Team
 * @version 1.0.0
 */

const BaseController = require('../core/BaseController');
const AdminService = require('../services/AdminService');
const UserRepository = require('../repositories/UserRepository');
const AppointmentRepository = require('../repositories/AppointmentRepository');
const Logger = require('../utils/Logger');

/**
 * AdminController class handling admin-specific HTTP requests
 * Extends BaseController following SOLID principles
 */
class AdminController extends BaseController {
  /**
   * Creates an instance of AdminController
   */
  constructor() {
    // Initialize repositories
    const userRepository = new UserRepository();
    const appointmentRepository = new AppointmentRepository();

    // Initialize service with dependency injection
    const adminService = new AdminService(
      userRepository,
      appointmentRepository
    );

    super(adminService, Logger.getLogger('AdminController'));
  }
  /**
   * Gets dashboard overview statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardOverview(req, res) {
    await this.handleAsync(async (req, res) => {
      this.logAction('getDashboardOverview', req);
      
      const dashboardData = await this.service.getDashboardOverview();
      
      this.sendSuccess(res, dashboardData, 'Dashboard overview retrieved successfully');
    }, req, res);
  }

  /**
   * Generates patient visit report
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getPatientVisitReport(req, res) {
    await this.handleAsync(async (req, res) => {
      this.logAction('getPatientVisitReport', req, { filters: req.query });
      
      const filters = this.buildFilters(req, ['startDate', 'endDate', 'department', 'status']);
      const reportData = await this.service.generatePatientVisitReport(filters);
      
      this.sendSuccess(res, reportData, 'Patient visit report generated successfully');
    }, req, res);
  }

  /**
   * Generates staff utilization report
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStaffUtilizationReport(req, res) {
    await this.handleAsync(async (req, res) => {
      this.logAction('getStaffUtilizationReport', req, { filters: req.query });
      
      const filters = this.buildFilters(req, ['startDate', 'endDate', 'department']);
      const reportData = await this.service.generateStaffUtilizationReport(filters);
      
      this.sendSuccess(res, reportData, 'Staff utilization report generated successfully');
    }, req, res);
  }

  /**
   * Gets resource name for base controller
   * @returns {string} Resource name
   */
  getResourceName() {
    return 'Admin';
  }
}

// Export singleton instance
module.exports = new AdminController();
