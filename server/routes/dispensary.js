const express    = require('express');
const { body, validationResult } = require('express-validator');
const HealthCard   = require('../models/HealthCard');
const Prescription = require('../models/Prescription');
const Dispense     = require('../models/Dispense');
const auth         = require('../middleware/auth');
const authorize    = require('../middleware/authorize');

const requireVerifiedCredentials = require('../middleware/requireVerifiedCredentials');

const router = express.Router();

// All dispensary routes need auth. Roles are checked per route below - most are
// pharmacy staff only, but "send to dispensary" also allows the doctor.
router.use(auth);
router.use(requireVerifiedCredentials); // clinical staff must be admin-verified

// Pharmacy-staff-only guard, applied to the dispensing/viewing routes
const pharmacyStaff = authorize('pharmacist', 'admin', 'staff');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// POST /api/dispensary/scan - scan a health card, return patient + pending prescriptions
router.post('/scan',
  pharmacyStaff,
  [body('cardNumber').optional().trim(), body('qrData').optional().trim()],
  validate,
  async (req, res) => {
    try {
      let { cardNumber, qrData } = req.body;

      // Parse JSON QR payload if provided
      if (qrData && !cardNumber) {
        try {
          const parsed = JSON.parse(qrData);
          cardNumber = parsed.cardNumber;
        } catch {
          cardNumber = qrData;
        }
      }

      if (!cardNumber) {
        return res.status(400).json({ success: false, message: 'Card number is required' });
      }

      const card = await HealthCard.findOne({ cardNumber: cardNumber.trim().toUpperCase() })
        .populate('patient', 'firstName lastName phone digitalHealthCardId');

      if (!card) {
        return res.status(404).json({ success: false, message: 'Health card not found' });
      }
      if (card.status !== 'active') {
        return res.status(400).json({ success: false, message: `Health card is ${card.status}` });
      }

      // Fetch prescriptions that are awaiting dispensing or still active
      const prescriptions = await Prescription.find({
        patient: card.patient._id,
        status: { $in: ['awaiting_dispensing', 'active'] },
        expiryDate: { $gt: new Date() }
      })
        .populate('doctor', 'firstName lastName specialization')
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        data: {
          patient: card.patient,
          healthCard: { cardNumber: card.cardNumber, status: card.status, bloodGroup: card.bloodGroup },
          prescriptions
        }
      });
    } catch (err) {
      console.error('Dispensary scan error:', err);
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// GET /api/dispensary/queue - all prescriptions waiting to be dispensed
router.get('/queue', pharmacyStaff, async (req, res) => {
  try {
    const prescriptions = await Prescription.find({
      status: 'awaiting_dispensing',
      expiryDate: { $gt: new Date() }
    })
      .populate('patient', 'firstName lastName phone digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization')
      .sort({ updatedAt: 1 }); // oldest first so nothing waits too long

    res.json({ success: true, data: { prescriptions } });
  } catch (err) {
    console.error('Dispensary queue error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
});

// PATCH /api/dispensary/prescriptions/:id/send - mark a prescription ready to collect
router.patch('/prescriptions/:id/send',
  authorize('pharmacist', 'admin', 'staff', 'doctor', 'receptionist'),
  async (req, res) => {
    try {
      const prescription = await Prescription.findById(req.params.id);
      if (!prescription) {
        return res.status(404).json({ success: false, message: 'Prescription not found' });
      }
      if (!['draft', 'active'].includes(prescription.status)) {
        return res.status(400).json({
          success: false,
          message: `Prescription is already ${prescription.status} — cannot send to dispensary`
        });
      }

      prescription.status = 'awaiting_dispensing';
      prescription.auditTrail.push({
        action: 'sent_to_dispensary',
        performedBy: req.user.id,
        details: `Sent to dispensary by ${req.user.role}`
      });
      await prescription.save();

      res.json({
        success: true,
        message: 'Prescription sent to dispensary queue',
        data: { prescription }
      });
    } catch (err) {
      console.error('Send to dispensary error:', err);
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// POST /api/dispensary/prescriptions/:id/dispense - pharmacist issues the medicines
router.post('/prescriptions/:id/dispense',
  pharmacyStaff,
  [
    body('itemsDispensed').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('itemsDispensed.*.drugName').notEmpty().withMessage('Drug name is required'),
    body('itemsDispensed.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
    body('notes').optional().trim()
  ],
  validate,
  async (req, res) => {
    try {
      const prescription = await Prescription.findById(req.params.id)
        .populate('patient', 'firstName lastName digitalHealthCardId');

      if (!prescription) {
        return res.status(404).json({ success: false, message: 'Prescription not found' });
      }
      if (!['active', 'awaiting_dispensing'].includes(prescription.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot dispense a prescription with status '${prescription.status}'`
        });
      }
      if (prescription.expiryDate < new Date()) {
        return res.status(400).json({ success: false, message: 'Prescription has expired' });
      }

      const { itemsDispensed, notes } = req.body;

      // Create the dispense audit record
      const dispense = await Dispense.create({
        prescription: prescription._id,
        patient:      prescription.patient._id,
        dispensedBy:  req.user.id,
        itemsDispensed,
        notes: notes || ''
      });

      // Transition the prescription to dispensed → completed
      prescription.status = 'dispensed';
      prescription.auditTrail.push({
        action: 'dispensed',
        performedBy: req.user.id,
        details: `Dispensed by ${req.user.firstName || req.user.id}; dispense record: ${dispense._id}`
      });
      await prescription.save();

      await dispense.populate('dispensedBy', 'firstName lastName');

      res.status(201).json({
        success: true,
        message: 'Medicines issued successfully',
        data: { dispense, prescription }
      });
    } catch (err) {
      console.error('Dispense error:', err);
      res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
    }
  }
);

// GET /api/dispensary/history - recent dispense records
router.get('/history', pharmacyStaff, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const filter = {};
    if (req.query.patientId) filter.patient = req.query.patientId;

    const history = await Dispense.find(filter)
      .populate('patient', 'firstName lastName digitalHealthCardId')
      .populate('dispensedBy', 'firstName lastName')
      .populate({ path: 'prescription', select: 'prescriptionNumber doctor', populate: { path: 'doctor', select: 'firstName lastName' } })
      .sort({ dispensedAt: -1 })
      .limit(limit);

    res.json({ success: true, data: { history } });
  } catch (err) {
    console.error('Dispense history error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
});

// GET /api/dispensary/prescriptions/:id - single prescription detail
router.get('/prescriptions/:id', pharmacyStaff, async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate('patient', 'firstName lastName phone digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization');

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    res.json({ success: true, data: { prescription } });
  } catch (err) {
    console.error('Get prescription error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
});

module.exports = router;
