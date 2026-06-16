const express = require('express');
const router = express.Router();
const Prescription = require('../models/Prescription');
const User = require('../models/User');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET /api/prescriptions/patient/:patientId
// Doctor, staff, or the patient themselves can fetch prescription history
router.get('/patient/:patientId', auth, authorize('doctor', 'staff', 'admin', 'patient'), async (req, res) => {
  try {
    const { patientId } = req.params;

    if (req.user.role === 'patient' && req.user.id !== patientId) {
      return res.status(403).json({ success: false, message: 'Not authorized to view these prescriptions' });
    }

    const prescriptions = await Prescription.find({
      patient: patientId,
      status: { $in: ['active', 'completed', 'expired', 'draft'] }
    })
      .populate('doctor', 'firstName lastName specialization department')
      .sort({ prescribedDate: -1 });

    res.json({ success: true, count: prescriptions.length, data: { prescriptions } });
  } catch (error) {
    console.error('Get patient prescriptions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/prescriptions
// Doctors create a prescription — accepts both formal form (strict fields) and
// consultation form (simplified: name, form, frequency, duration, instructions).
router.post('/', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { patientId, medications, diagnosis, indication, notes, medicalRecord, appointmentId } = req.body;

    if (!patientId || !medications?.length || !diagnosis) {
      return res.status(400).json({
        success: false,
        message: 'patientId, medications (array), and diagnosis are required'
      });
    }

    const patient = await User.findOne({ _id: patientId, role: 'patient', isActive: true });
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    // Normalize medications — handles both strict form (drugName/strength/dosageForm/dosage)
    // and simplified consultation form (name/form/frequency/duration).
    const DOSAGE_FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'inhaler', 'patch'];
    const normalizedMedications = medications.map(med => {
      const formStr = (med.form || med.strength || '').toLowerCase();
      const detectedForm = DOSAGE_FORMS.find(f => formStr.includes(f)) || 'tablet';
      return {
        drugName:    med.drugName || med.name || 'Unknown Drug',
        genericName: med.genericName || '',
        strength:    med.strength || med.form || 'as prescribed',
        dosageForm:  DOSAGE_FORMS.includes(med.dosageForm) ? med.dosageForm : detectedForm,
        dosage:      med.dosage || med.frequency || 'as directed',
        frequency:   med.frequency || 'as directed',
        duration:    med.duration || 'as directed',
        quantity:    med.quantity || 1,
        instructions: med.instructions || ''
      };
    });

    const prescription = await Prescription.create({
      patient: patientId,
      doctor: req.user.id,
      medications: normalizedMedications,
      diagnosis,
      indication: indication || diagnosis,
      notes: notes || '',
      medicalRecord: medicalRecord || null,
      appointment: appointmentId || null,
      status: 'active',
      prescribedDate: new Date(),
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      auditTrail: [{ action: 'created', performedBy: req.user.id, details: 'Prescription created' }]
    });

    await prescription.populate([
      { path: 'doctor', select: 'firstName lastName specialization' },
      { path: 'patient', select: 'firstName lastName digitalHealthCardId' }
    ]);

    res.status(201).json({ success: true, data: { prescription } });
  } catch (error) {
    console.error('Create prescription error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// GET /api/prescriptions/:id
// Get a single prescription — accessible by the patient it belongs to, the prescribing doctor, or admin
router.get('/:id', auth, async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate('doctor', 'firstName lastName specialization department')
      .populate('patient', 'firstName lastName digitalHealthCardId');

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const isOwner = prescription.patient._id.toString() === req.user.id;
    const isPrescriber = prescription.doctor._id.toString() === req.user.id;
    const isPrivileged = ['admin', 'staff'].includes(req.user.role);

    if (!isOwner && !isPrescriber && !isPrivileged) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.json({ success: true, data: { prescription } });
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
