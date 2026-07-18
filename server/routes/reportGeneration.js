const express = require('express');
const router = express.Router();
const ReportGenerationController = require('../controllers/ReportGenerationController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { body, validationResult } = require('express-validator');

// @desc    Generate Patient Visit Report
// @route   POST /api/report-generation/patient-visits
// @access  Private (Admin, Staff)
router.post('/patient-visits', [
  auth,
  authorize('staff', 'admin'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('department').optional().isString(),
  body('status').optional().isIn(['scheduled', 'confirmed', 'completed', 'cancelled', 'no-show'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Set query parameters from request body
    req.query = req.body;
    await ReportGenerationController.generatePatientVisitReport(req, res);
  } catch (error) {
    console.error('Error in patient visit report route:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Generate Staff Utilization Report
// @route   POST /api/report-generation/staff-utilization
// @access  Private (Admin, Staff)
router.post('/staff-utilization', [
  auth,
  authorize('staff', 'admin'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('department').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    req.query = req.body;
    await ReportGenerationController.generateStaffUtilizationReport(req, res);
  } catch (error) {
    console.error('Error in staff utilization report route:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Generate Comprehensive Report
// @route   POST /api/report-generation/comprehensive
// @access  Private (Admin)
router.post('/comprehensive', [
  auth,
  authorize('admin'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    req.query = req.body;
    await ReportGenerationController.generateComprehensiveReport(req, res);
  } catch (error) {
    console.error('Error in comprehensive report route:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Generate and Save Report
// @route   POST /api/report-generation/generate-and-save
// @access  Private (Admin, Staff)
router.post('/generate-and-save', [
  auth,
  authorize('staff', 'admin'),
  body('reportType').isIn(['patient-visits', 'staff-utilization', 'comprehensive']).withMessage('Valid report type is required'),
  body('title').notEmpty().withMessage('Report title is required'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('description').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { reportType, title, description, startDate, endDate, ...filters } = req.body;

    // Generate the report data based on type
    let reportData;
    const tempReq = { query: { startDate, endDate, ...filters } };
    const tempRes = {
      json: (data) => { reportData = data; }
    };

    switch (reportType) {
      case 'patient-visits':
        await ReportGenerationController.generatePatientVisitReport(tempReq, tempRes);
        break;
      case 'staff-utilization':
        await ReportGenerationController.generateStaffUtilizationReport(tempReq, tempRes);
        break;
      case 'comprehensive':
        await ReportGenerationController.generateComprehensiveReport(tempReq, tempRes);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid report type'
        });
    }

    if (!reportData || !reportData.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate report data'
      });
    }

    // Save to GeneratedReport collection
    const GeneratedReport = require('../models/GeneratedReport');
    
    const savedReport = new GeneratedReport({
      title,
      reportType,
      description: description || `Generated ${reportType.replace('-', ' ')} report`,
      dateRange: { startDate, endDate },
      filters,
      summary: {
        totalRecords: Array.isArray(reportData.data.appointments) ? reportData.data.appointments.length :
                     Array.isArray(reportData.data.transactions) ? reportData.data.transactions.length :
                     Array.isArray(reportData.data.staffUtilization) ? reportData.data.staffUtilization.length : 0,
        keyMetrics: reportData.data.summary || reportData.data.analytics || {}
      },
      data: reportData.data,
      generatedBy: req.user.id,
      status: 'completed',
      tags: [reportType, 'auto-generated']
    });

    await savedReport.save();
    await savedReport.populate('generatedBy', 'firstName lastName email role');

    res.status(201).json({
      success: true,
      message: 'Report generated and saved successfully',
      data: {
        report: savedReport,
        reportData: reportData.data
      }
    });

  } catch (error) {
    console.error('Error generating and saving report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate and save report'
    });
  }
});

// @desc    Test endpoint
// @route   GET /api/report-generation/test
// @access  Private (Admin, Staff)
router.get('/test', auth, authorize('staff', 'admin'), (req, res) => {
  res.json({
    success: true,
    message: 'Report generation API is working',
    timestamp: new Date().toISOString(),
    user: req.user.firstName + ' ' + req.user.lastName
  });
});

// @desc    Get Available Report Types
// @route   GET /api/report-generation/types
// @access  Private (Admin, Staff)
router.get('/types', auth, authorize('staff', 'admin'), (req, res) => {
  const reportTypes = [
    {
      id: 'patient-visits',
      name: 'Patient Visit Report',
      description: 'Analyze patient visit patterns, appointment statistics, and flow metrics',
      fields: ['startDate', 'endDate', 'department', 'status'],
      estimatedTime: '2-5 minutes'
    },
    {
      id: 'staff-utilization',
      name: 'Staff Utilization Report',
      description: 'Track doctor and staff performance, utilization rates, and productivity metrics',
      fields: ['startDate', 'endDate', 'department'],
      estimatedTime: '3-7 minutes'
    },
    {
      id: 'comprehensive',
      name: 'Comprehensive Report',
      description: 'Complete overview combining patient visits and staff utilization data',
      fields: ['startDate', 'endDate'],
      estimatedTime: '5-10 minutes'
    }
  ];

  res.json({
    success: true,
    data: reportTypes
  });
});

module.exports = router;
