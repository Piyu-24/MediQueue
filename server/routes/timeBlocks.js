const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const TimeBlock = require('../models/TimeBlock');
const { generateBlocksForRange, getAvailableBlocks, createBlock, updateBlock } = require('../services/TimeBlockService');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ── GET /api/time-blocks ──────────────────────────────────────────────────────
// Get available time blocks for booking.
// Public-readable (auth required); shows only appointment-available slots to patients.
// Admin/receptionist/staff get full data including walk-in counts.
//
// Query params:
//   date           YYYY-MM-DD  (required)
//   departmentId   ObjectId    (required for General OPD)
//   doctorId       ObjectId    (optional; if provided, returns specialist blocks)
//   includeAll     boolean     (admin/staff only — include closed/full blocks)
router.get(
  '/',
  auth,
  [
    query('date')
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('date must be YYYY-MM-DD'),
    query('departmentId')
      .optional()
      .isMongoId()
      .withMessage('departmentId must be a valid ObjectId')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { date, departmentId, doctorId, includeAll } = req.query;

      const isStaff = ['admin', 'receptionist', 'staff', 'doctor'].includes(req.user.role);
      const showAll = isStaff && includeAll === 'true';

      if (!departmentId && !doctorId) {
        return res.status(400).json({
          success: false,
          message: 'Either departmentId or doctorId is required'
        });
      }

      let blocks;
      if (showAll) {
        // Staff: return all blocks for that dept/date regardless of status
        const filter = { date };
        if (departmentId) filter.departmentId = departmentId;
        if (doctorId) filter.doctorId = doctorId;
        else if (!departmentId) filter.doctorId = null;

        blocks = await TimeBlock.find(filter)
          .sort({ startTime: 1 })
          .lean({ virtuals: true });
      } else {
        // Patients / general: only active blocks with remaining slots
        blocks = await getAvailableBlocks(
          departmentId || null,
          date,
          doctorId || null
        );
      }

      // For patients, hide internal capacity numbers — show only slot status
      const responseBlocks = blocks.map(b => {
        const base = {
          _id: b._id,
          departmentId: b.departmentId,
          doctorId: b.doctorId,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          sessionName: b.sessionName,
          reportingTime: b.reportingTime,
          status: b.status,
          availabilityStatus: b.availabilityStatus || (
            b.bookedAppointmentCount >= b.appointmentCapacity ? 'FULLY_BOOKED' :
            b.bookedAppointmentCount >= b.appointmentCapacity * 0.8 ? 'LIMITED' :
            'AVAILABLE'
          ),
          remainingSlots: Math.max(0, b.appointmentCapacity - b.bookedAppointmentCount)
        };
        // Staff get full data
        if (isStaff) {
          Object.assign(base, {
            totalCapacity: b.totalCapacity,
            appointmentCapacity: b.appointmentCapacity,
            walkInCapacity: b.walkInCapacity,
            emergencyBuffer: b.emergencyBuffer,
            operationalBuffer: b.operationalBuffer,
            bookedAppointmentCount: b.bookedAppointmentCount,
            walkInCount: b.walkInCount,
            emergencyCount: b.emergencyCount
          });
        }
        return base;
      });

      res.json({ success: true, data: responseBlocks, count: responseBlocks.length });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── GET /api/time-blocks/:id ──────────────────────────────────────────────────
router.get(
  '/:id',
  auth,
  [param('id').isMongoId().withMessage('Invalid time block ID')],
  handleValidation,
  async (req, res) => {
    try {
      const block = await TimeBlock.findById(req.params.id)
        .populate('departmentId', 'name code')
        .populate('doctorId', 'firstName lastName specialization')
        .lean({ virtuals: true });

      if (!block) return res.status(404).json({ success: false, message: 'Time block not found' });

      res.json({ success: true, data: block });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── POST /api/time-blocks ─────────────────────────────────────────────────────
// Admin/staff — create a single time block
router.post(
  '/',
  auth,
  authorize('admin', 'staff'),
  [
    body('departmentId').isMongoId().withMessage('Valid departmentId is required'),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD'),
    body('startTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('startTime must be HH:MM'),
    body('endTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('endTime must be HH:MM'),
    body('totalCapacity').isInt({ min: 1 }).withMessage('totalCapacity must be a positive integer'),
    body('sessionName').optional().trim().isLength({ max: 60 }),
    body('doctorId').optional().isMongoId(),
    body('appointmentCapacity').optional().isInt({ min: 0 }),
    body('walkInCapacity').optional().isInt({ min: 0 }),
    body('emergencyBuffer').optional().isInt({ min: 0 }),
    body('reportingOffsetMinutes').optional().isInt({ min: 0 })
  ],
  handleValidation,
  async (req, res) => {
    try {
      const block = await createBlock({ ...req.body, createdBy: req.user._id });
      res.status(201).json({ success: true, data: block, message: 'Time block created successfully' });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'A time block already exists for this department/doctor/date/startTime'
        });
      }
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// ── POST /api/time-blocks/generate ───────────────────────────────────────────
// Admin — bulk generate blocks for a date range from a template
router.post(
  '/generate',
  auth,
  authorize('admin'),
  [
    body('departmentId').isMongoId().withMessage('Valid departmentId is required'),
    body('startDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('startDate must be YYYY-MM-DD'),
    body('endDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('endDate must be YYYY-MM-DD'),
    body('blockTemplates').isArray({ min: 1 }).withMessage('blockTemplates must be a non-empty array'),
    body('blockTemplates.*.startTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('startTime must be HH:MM'),
    body('blockTemplates.*.endTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('endTime must be HH:MM'),
    body('blockTemplates.*.totalCapacity').isInt({ min: 1 }).withMessage('totalCapacity must be a positive integer'),
    body('doctorId').optional().isMongoId()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { departmentId, startDate, endDate, blockTemplates, doctorId } = req.body;

      const result = await generateBlocksForRange({
        departmentId,
        startDate,
        endDate,
        blockTemplates,
        doctorId: doctorId || null,
        createdBy: req.user._id
      });

      res.status(201).json({
        success: true,
        message: `Generated ${result.created} block(s). Skipped ${result.skipped} existing.`,
        created: result.created,
        skipped: result.skipped
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// ── PATCH /api/time-blocks/:id ────────────────────────────────────────────────
// Admin/staff — update a block's capacity or status
router.patch(
  '/:id',
  auth,
  authorize('admin', 'staff'),
  [
    param('id').isMongoId().withMessage('Invalid time block ID'),
    body('appointmentCapacity').optional().isInt({ min: 0 }),
    body('walkInCapacity').optional().isInt({ min: 0 }),
    body('emergencyBuffer').optional().isInt({ min: 0 }),
    body('operationalBuffer').optional().isInt({ min: 0 }),
    body('totalCapacity').optional().isInt({ min: 1 }),
    body('status').optional().isIn(['active', 'closed', 'cancelled']),
    body('sessionName').optional().trim().isLength({ max: 60 }),
    body('notes').optional().trim().isLength({ max: 300 }),
    body('reportingOffsetMinutes').optional().isInt({ min: 0 })
  ],
  handleValidation,
  async (req, res) => {
    try {
      const updates = { ...req.body };
      delete updates._id;
      delete updates.departmentId;
      delete updates.doctorId;
      delete updates.date;
      delete updates.startTime;
      delete updates.endTime;
      delete updates.bookedAppointmentCount;
      delete updates.walkInCount;
      delete updates.emergencyCount;

      const block = await updateBlock(req.params.id, updates);
      res.json({ success: true, data: block, message: 'Time block updated successfully' });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// ── DELETE /api/time-blocks/:id ───────────────────────────────────────────────
// Admin — cancel a block (if no appointments booked yet)
router.delete(
  '/:id',
  auth,
  authorize('admin'),
  [param('id').isMongoId().withMessage('Invalid time block ID')],
  handleValidation,
  async (req, res) => {
    try {
      const block = await TimeBlock.findById(req.params.id);
      if (!block) return res.status(404).json({ success: false, message: 'Time block not found' });

      if (block.bookedAppointmentCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete a block with ${block.bookedAppointmentCount} existing appointment(s). Cancel or close it instead.`
        });
      }

      await block.deleteOne();
      res.json({ success: true, message: 'Time block deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
