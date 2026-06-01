const express = require('express');
const { body, query, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const LeaveNotificationService = require('../services/LeaveNotificationService');

const router = express.Router();

const validateLeave = [
  body('startDate').isISO8601().withMessage('Valid startDate is required'),
  body('endDate').optional().isISO8601().withMessage('Valid endDate is required'),
  body('leaveType').optional().isIn(['FULL_DAY', 'PARTIAL_DAY']).withMessage('Invalid leaveType'),
  body('reason').optional().isString().isLength({ max: 50 }),
  body('description').optional().isString().isLength({ max: 200 }),
  body('startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('startTime must be HH:MM'),
  body('endTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('endTime must be HH:MM')
];

// POST /api/doctor/leave
router.post('/leave', auth, authorize('doctor'), validateLeave, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const dryRun = req.query.dryRun === 'true' || req.body.dryRun === true;

    const requestInfo = {
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || 'Unknown'
    };

    const result = await LeaveNotificationService.processLeave(
      req.user.id,
      req.body,
      req.user,
      req.app.get('io'),
      { dryRun, requestInfo }
    );

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Submit leave error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to submit leave'
    });
  }
});

// GET /api/doctor/leave
router.get('/leave', auth, authorize('doctor'), [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
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

    const { startDate, endDate } = req.query;
    const leaves = await LeaveNotificationService.listLeaves(req.user.id, startDate, endDate);

    return res.status(200).json({
      success: true,
      data: { leaves }
    });
  } catch (error) {
    console.error('List leave error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to load leaves'
    });
  }
});

// DELETE /api/doctor/leave/:slotId
router.delete('/leave/:slotId', auth, authorize('doctor'), async (req, res) => {
  try {
    const requestInfo = {
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || 'Unknown'
    };

    const result = await LeaveNotificationService.cancelLeave(req.user.id, req.params.slotId, requestInfo);

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Leave cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel leave error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel leave'
    });
  }
});

module.exports = router;
