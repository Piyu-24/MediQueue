// Admin routes

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/AdminController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const ValidationHelper = require('../utils/ValidationHelper');
const Logger = require('../utils/Logger');

const logger = Logger.getLogger('AdminRoutes');

// @desc    Get dashboard overview statistics
// @route   GET /api/admin/dashboard/overview
// @access  Private (Admin only)
router.get('/dashboard/overview',
  auth,
  authorize('admin'),
  adminController.getDashboardOverview.bind(adminController)
);

// @desc    Get patient visit report
// @route   GET /api/admin/reports/patient-visits
// @access  Private (Admin, Staff)
router.get('/reports/patient-visits',
  auth,
  authorize('staff', 'admin'),
  ValidationHelper.validateDateRange(),
  adminController.getPatientVisitReport.bind(adminController)
);

// @desc    Get staff utilization report
// @route   GET /api/admin/reports/staff-utilization
// @access  Private (Admin, Staff)
router.get('/reports/staff-utilization',
  auth,
  authorize('staff', 'admin'),
  ValidationHelper.validateDateRange(),
  adminController.getStaffUtilizationReport.bind(adminController)
);

// Error handling middleware for admin routes
router.use((error, req, res, next) => {
  logger.error('Admin route error:', {
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id
  });
  next(error);
});

module.exports = router;
