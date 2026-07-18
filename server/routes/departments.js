const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Department = require('../models/Department');
const Room       = require('../models/Room');
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

// GET /api/departments - list all departments
router.get(
  '/',
  auth,
  async (req, res) => {
    try {
      const { status, search } = req.query;
      const filter = {};

      if (status) filter.status = status;
      if (search) filter.$text = { $search: search };

      const departments = await Department.find(filter)
        .sort({ name: 1 })
        .lean();

      res.json({ success: true, data: departments });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// GET /api/departments/:id
router.get(
  '/:id',
  auth,
  [param('id').isMongoId().withMessage('Invalid department ID')],
  handleValidation,
  async (req, res) => {
    try {
      const dept = await Department.findById(req.params.id).lean();
      if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });
      res.json({ success: true, data: dept });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// POST /api/departments - create department (admin only)
router.post(
  '/',
  auth,
  authorize('admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required')
      .isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),
    body('code').trim().notEmpty().withMessage('Code is required')
      .isLength({ max: 10 }).withMessage('Code cannot exceed 10 characters')
      .matches(/^[A-Z0-9_-]+$/i).withMessage('Code must contain only letters, digits, hyphens, or underscores'),
    body('description').optional().trim().isLength({ max: 500 }),
    body('averageConsultationMinutes').optional().isInt({ min: 1 }).withMessage('Must be a positive integer'),
    body('status').optional().isIn(['active', 'inactive']),
    body('hasMultipleRooms').optional().isBoolean()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const {
        name, code, description, averageConsultationMinutes, status,
        location, contactPhone, operatingHours, hasMultipleRooms
      } = req.body;

      const dept = await Department.create({
        name,
        code: code.toUpperCase(),
        description,
        averageConsultationMinutes,
        status,
        location,
        contactPhone,
        operatingHours,
        hasMultipleRooms: !!hasMultipleRooms,
        createdBy: req.user._id
      });

      // For single-room departments, auto-create the consultation room
      if (!hasMultipleRooms) {
        await Room.create({
          roomNumber:    `${dept.code}-01`,
          displayName:   `${dept.name} Consultation Room`,
          department:    dept._id,
          status:        'available',
          isAutoManaged: true
        });
      }

      res.status(201).json({ success: true, data: dept, message: 'Department created successfully' });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'A department with this code already exists' });
      }
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// PATCH /api/departments/:id - update department (admin only)
router.patch(
  '/:id',
  auth,
  authorize('admin'),
  [
    param('id').isMongoId().withMessage('Invalid department ID'),
    body('name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('code').optional().trim().notEmpty().isLength({ max: 10 })
      .matches(/^[A-Z0-9_-]+$/i),
    body('description').optional().trim().isLength({ max: 500 }),
    body('averageConsultationMinutes').optional().isInt({ min: 1 }),
    body('status').optional().isIn(['active', 'inactive']),
    body('hasMultipleRooms').optional().isBoolean()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const updates = req.body;
      if (updates.code) updates.code = updates.code.toUpperCase();

      // Disallow changing _id
      delete updates._id;

      const dept = await Department.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
      );
      if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

      res.json({ success: true, data: dept, message: 'Department updated successfully' });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'A department with this code already exists' });
      }
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// DELETE /api/departments/:id - soft delete, sets status to inactive (admin only)
router.delete(
  '/:id',
  auth,
  authorize('admin'),
  [param('id').isMongoId().withMessage('Invalid department ID')],
  handleValidation,
  async (req, res) => {
    try {
      const dept = await Department.findByIdAndUpdate(
        req.params.id,
        { $set: { status: 'inactive' } },
        { new: true }
      );
      if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

      res.json({ success: true, message: 'Department deactivated successfully', data: dept });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

module.exports = router;
