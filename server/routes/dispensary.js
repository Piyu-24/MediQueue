const express    = require('express');
const { body, validationResult } = require('express-validator');
const HealthCard   = require('../models/HealthCard');
const Prescription = require('../models/Prescription');
const Dispense     = require('../models/Dispense');
const User         = require('../models/User');
const auth         = require('../middleware/auth');
const authorize    = require('../middleware/authorize');

const router = express.Router();

// All dispensary routes require authentication. Role authorization is applied
// per-route below — most routes are pharmacist/admin/staff only, but the
// "send to dispensary" action must also allow the prescribing doctor.
router.use(auth);

// Pharmacy-staff-only guard, applied to the dispensing/viewing routes
const pharmacyStaff = authorize('pharmacist', 'admin', 'staff');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// SCAN QR / HEALTH CARD  →  return patient + pending prescriptions
// POST /api/dispensary/scan
// Body: { cardNumber } or { qrData }
// ─────────────────────────────────────────────────────────────────────────────
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
        .populate('patient', 'firstName lastName phone dateOfBirth gender digitalHealthCardId');

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
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE  —  all prescriptions awaiting dispensing (most recent first)
// GET /api/dispensary/queue
// ─────────────────────────────────────────────────────────────────────────────
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
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SEND TO DISPENSARY  —  doctor/staff marks a prescription ready to collect
// PATCH /api/dispensary/prescriptions/:id/send
// ─────────────────────────────────────────────────────────────────────────────
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
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DISPENSE  —  pharmacist issues medicines and records the event
// POST /api/dispensary/prescriptions/:id/dispense
// Body: { itemsDispensed: [{ drugName, strength, dosageForm, quantity, batchNumber, notes }], notes }
// ─────────────────────────────────────────────────────────────────────────────
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
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DISPENSE HISTORY  —  recent dispense records (pharmacist view)
// GET /api/dispensary/history?limit=50&patientId=xxx
// ─────────────────────────────────────────────────────────────────────────────
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
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET single prescription detail (for dispensary view)
// GET /api/dispensary/prescriptions/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/prescriptions/:id', pharmacyStaff, async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate('patient', 'firstName lastName phone dateOfBirth gender digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization');

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    res.json({ success: true, data: { prescription } });
  } catch (err) {
    console.error('Get prescription error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
