const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Room       = require('../models/Room');
const Department = require('../models/Department');
const User       = require('../models/User');
const auth       = require('../middleware/auth');
const authorize  = require('../middleware/authorize');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array()[0];
    return res.status(400).json({ success: false, message: first.msg, errors: errors.array() });
  }
  next();
};

// GET /api/rooms - list rooms, optionally filtered by department/status.
// effectiveStatus follows the department status for auto-managed rooms.
router.get('/', auth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.departmentId) filter.department = req.query.departmentId;
    if (req.query.status)       filter.status     = req.query.status;

    const rooms = await Room.find(filter)
      .populate('department', 'name code status')
      .populate('assignedDoctors', 'firstName lastName specialization')
      .sort({ roomNumber: 1 })
      .lean();

    const enriched = rooms.map(r => ({
      ...r,
      effectiveStatus: r.isAutoManaged
        ? (r.department?.status === 'active' ? 'available' : 'unavailable')
        : r.status
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
});

// GET /api/rooms/department/:id/auto
// The single auto-managed room for a non-OPD department, so reception can
// assign a room without a dropdown.
router.get('/department/:id/auto',
  auth,
  [param('id').isMongoId().withMessage('Invalid department ID')],
  handleValidation,
  async (req, res) => {
    try {
      const room = await Room.findOne({
        department: req.params.id,
        isAutoManaged: true
      }).populate('department', 'name code status').lean();

      if (!room) {
        return res.status(404).json({
          success: false,
          message: 'No auto-managed room found for this department'
        });
      }

      const effectiveStatus = room.department?.status === 'active' ? 'available' : 'unavailable';
      res.json({ success: true, data: { ...room, effectiveStatus } });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// POST /api/rooms - admin creates a room (for OPD consultation rooms)
router.post('/',
  auth,
  authorize('admin'),
  [
    body('roomNumber').trim().notEmpty().withMessage('Room number is required')
      .isLength({ max: 30 }),
    body('displayName').trim().notEmpty().withMessage('Display name is required')
      .isLength({ max: 100 }),
    body('department').isMongoId().withMessage('Valid department ID is required'),
    body('status').optional().isIn(['available', 'unavailable']),
    body('isAutoManaged').optional().isBoolean()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { roomNumber, displayName, department, status, isAutoManaged } = req.body;

      const dept = await Department.findById(department);
      if (!dept) return res.status(404).json({ success: false, message: 'Department not found' });

      const room = await Room.create({
        roomNumber:    roomNumber.toUpperCase(),
        displayName,
        department,
        status:        status || 'available',
        isAutoManaged: isAutoManaged !== undefined ? isAutoManaged : false
      });

      const populated = await Room.findById(room._id)
        .populate('department', 'name code status').lean();

      res.status(201).json({ success: true, data: populated, message: 'Room created successfully' });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'A room with this number already exists' });
      }
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// PATCH /api/rooms/:id - admin updates room status or display name
router.patch('/:id',
  auth,
  authorize('admin'),
  [
    param('id').isMongoId().withMessage('Invalid room ID'),
    body('status').optional().isIn(['available', 'unavailable']),
    body('displayName').optional().trim().notEmpty().isLength({ max: 100 }),
    body('assignedDoctors').optional().isArray().withMessage('assignedDoctors must be an array'),
    body('assignedDoctors.*').optional().isMongoId().withMessage('Each assigned doctor must be a valid ID')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.status !== undefined)      updates.status      = req.body.status;
      if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;

      // Replace the assigned doctors, making sure each one is an active doctor
      if (req.body.assignedDoctors !== undefined) {
        const ids = [...new Set(req.body.assignedDoctors.map(String))];
        if (ids.length > 0) {
          const validCount = await User.countDocuments({
            _id: { $in: ids }, role: 'doctor', isActive: true
          });
          if (validCount !== ids.length) {
            return res.status(400).json({
              success: false,
              message: 'One or more assigned doctors are invalid or inactive.'
            });
          }
        }
        updates.assignedDoctors = ids;
      }

      const room = await Room.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
      )
        .populate('department', 'name code status')
        .populate('assignedDoctors', 'firstName lastName specialization');

      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

      res.json({ success: true, data: room, message: 'Room updated' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// DELETE /api/rooms/:id - admin deletes a room.
// Only OPD rooms can be deleted; auto-managed ones follow their department.
router.delete('/:id',
  auth,
  authorize('admin'),
  [param('id').isMongoId().withMessage('Invalid room ID')],
  handleValidation,
  async (req, res) => {
    try {
      const room = await Room.findById(req.params.id);
      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

      if (room.isAutoManaged) {
        return res.status(400).json({
          success: false,
          message: 'Auto-managed rooms cannot be deleted. Deactivate the department instead.'
        });
      }

      await room.deleteOne();
      res.json({ success: true, message: 'Room deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

module.exports = router;
