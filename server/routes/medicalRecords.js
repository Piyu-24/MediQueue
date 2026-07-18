const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { signFileUrl } = require('../utils/signedFileUrl');
const { saveUpload, deleteUpload } = require('../utils/fileStorage');

const router = express.Router();

// Swap each attached file's stored path for a short-lived signed URL,
// so files aren't exposed through a public route
function withSignedRecord(record) {
  if (!record) return record;
  const obj = typeof record.toObject === 'function' ? record.toObject() : { ...record };
  if (Array.isArray(obj.documents)) {
    obj.documents = obj.documents.map(doc => {
      if (doc && doc.fileUrl) return { ...doc, fileUrl: signFileUrl(doc.fileUrl) };
      return doc;
    });
  }
  return obj;
}

// Keep uploads in memory; saveUpload() stores them afterwards
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and PDF are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

// @desc    Get medical records
// @route   GET /api/medical-records
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    let query = { status: 'active' };
    
    // Filter based on user role
    if (req.user.role === 'patient') {
      query.patient = req.user.id;
    } else if (req.user.role === 'doctor') {
      // Doctors can see records they created
      query.$or = [
        { doctor: req.user.id },
        { createdBy: req.user.id }
      ];
    }
    
    // Additional filters from query params
    const { patientId, recordType, startDate, endDate, search } = req.query;
    
    // Only admin, staff, and receptionist can filter by patient
    if (patientId && ['admin', 'staff', 'receptionist'].includes(req.user.role)) {
      query.patient = patientId;
    }
    
    if (recordType) {
      query.recordType = recordType;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    if (search) {
      query.$text = { $search: search };
    }
    
    let dbQuery = MedicalRecord.find(query)
      .populate('patient', 'firstName lastName email digitalHealthCardId')
      .populate('doctor', 'firstName lastName specialization')
      .populate('createdBy', 'firstName lastName role')
      .populate('appointment')
      .sort({ createdAt: -1 })
      .limit(parseInt(req.query.limit) || 50);

    // A receptionist only attaches files, so don't send them the clinical content
    if (req.user.role === 'receptionist') {
      dbQuery = dbQuery.select('recordType title description createdAt documents patient');
    }

    const records = await dbQuery;

    // Log access for each record
    const clientIp = req.ip || req.connection.remoteAddress;
    for (const record of records) {
      await record.logAccess(req.user.id, 'view', clientIp);
    }
    
    res.json({
      success: true,
      count: records.length,
      data: { records: records.map(withSignedRecord) }
    });
  } catch (error) {
    console.error('Get medical records error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get single medical record
// @route   GET /api/medical-records/:id
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id)
      .populate('patient', 'firstName lastName email phone digitalHealthCardId bloodType allergies')
      .populate('doctor', 'firstName lastName specialization department')
      .populate('createdBy', 'firstName lastName role')
      .populate('appointment');
    
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }
    
    // Check authorization
    const isAuthorized = 
      record.patient._id.toString() === req.user.id ||
      record.doctor?._id.toString() === req.user.id ||
      record.createdBy._id.toString() === req.user.id ||
      ['staff', 'admin'].includes(req.user.role);
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this record'
      });
    }
    
    // Log access
    const clientIp = req.ip || req.connection.remoteAddress;
    await record.logAccess(req.user.id, 'view', clientIp);

    res.json({
      success: true,
      data: { record: withSignedRecord(record) }
    });
  } catch (error) {
    console.error('Get medical record error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Create medical record
// @route   POST /api/medical-records
// @access  Private (Doctor, Staff, Admin)
router.post('/', 
  auth, 
  authorize('doctor', 'staff', 'admin', 'receptionist'),
  [
    body('patient').isMongoId().withMessage('Valid patient ID is required'),
    body('recordType').isIn(['diagnosis', 'prescription', 'lab-result', 'imaging', 'surgery', 'vaccination', 'consultation', 'treatment-plan', 'other']),
    // title and description are optional for consultation records (derived from diagnosis/complaint)
    body('title').optional().isLength({ min: 2, max: 200 }).withMessage('Title must be between 2-200 characters'),
    body('description').optional().isLength({ min: 1, max: 2000 }).withMessage('Description cannot exceed 2000 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const { patient, recordType, title, description, appointment, doctor, ...otherFields } = req.body;
      
      // Verify patient exists
      const patientUser = await User.findOne({ _id: patient, role: 'patient', isActive: true });
      if (!patientUser) {
        return res.status(404).json({
          success: false,
          message: 'Patient not found'
        });
      }
      
      // For treatment plans, check if appointment already has one
      if (recordType === 'treatment-plan' && appointment) {
        const existingTreatmentPlan = await MedicalRecord.findOne({
          appointment: appointment,
          recordType: 'treatment-plan',
          status: 'active'
        });
        
        if (existingTreatmentPlan) {
          return res.status(400).json({
            success: false,
            message: 'This appointment already has a treatment plan. Each appointment can only have one treatment plan.',
            code: 'DUPLICATE_TREATMENT_PLAN'
          });
        }
      }
      
      // Verify doctor if provided
      if (doctor) {
        const doctorUser = await User.findOne({ _id: doctor, role: 'doctor', isActive: true });
        if (!doctorUser) {
          return res.status(404).json({
            success: false,
            message: 'Doctor not found'
          });
        }
      }
      
      // Derive title/description if not provided (e.g. consultation records from the OPD flow)
      const derivedTitle = req.body.title ||
        (req.body.chiefComplaint ? `Consultation: ${req.body.chiefComplaint}`.slice(0, 200) : 'OPD Consultation');
      const derivedDescription = req.body.description ||
        req.body.diagnosis || req.body.chiefComplaint || req.body.treatment || 'Consultation record';

      // The consultation form sends 'medications', but the schema uses 'prescriptions'
      if (otherFields.medications && !otherFields.prescriptions) {
        otherFields.prescriptions = otherFields.medications.map(med => ({
          medication:   med.name   || med.drugName || 'Unknown',
          dosage:       med.dosage || med.frequency || '',
          frequency:    med.frequency || '',
          duration:     med.duration  || '',
          instructions: med.instructions || ''
        }));
        delete otherFields.medications;
      }

      // Create record
      const record = await MedicalRecord.create({
        patient,
        recordType: recordType || 'consultation',
        title: derivedTitle,
        description: derivedDescription,
        appointment,
        doctor: doctor || (req.user.role === 'doctor' ? req.user.id : null),
        createdBy: req.user.id,
        ...otherFields
      });
      
      // Populate the record
      await record.populate([
        { path: 'patient', select: 'firstName lastName email' },
        { path: 'doctor', select: 'firstName lastName specialization' },
        { path: 'createdBy', select: 'firstName lastName role' }
      ]);
      
      // Log creation
      const clientIp = req.ip || req.connection.remoteAddress;
      await record.logAccess(req.user.id, 'create', clientIp);
      
      res.status(201).json({
        success: true,
        message: 'Medical record created successfully',
        data: { record }
      });
    } catch (error) {
      console.error('Create medical record error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Upload documents to medical record
// @route   POST /api/medical-records/:id/documents
// @access  Private (Doctor, Staff, Receptionist, Admin)
router.post('/:id/documents', 
  auth, 
  authorize('doctor', 'staff', 'receptionist', 'admin'),
  upload.array('documents', 10), // Allow up to 10 files
  async (req, res) => {
    let savedRefs = [];
    try {
      const record = await MedicalRecord.findById(req.params.id);

      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'Medical record not found'
        });
      }

      // Save each uploaded file
      const documents = [];
      for (const file of req.files) {
        const saved = await saveUpload(file, { folder: 'documents', prefix: 'medical-doc' });
        savedRefs.push(saved.ref);
        documents.push({
          fileName: file.originalname,
          fileUrl: saved.ref,          // stored path; signed when read back
          fileType: saved.mimeType,
          fileSize: saved.size,
          uploadedBy: req.user.id,
          uploadedAt: new Date()
        });
      }

      // Add documents to medical record
      if (!record.documents) {
        record.documents = [];
      }
      record.documents.push(...documents);

      await record.save();
      
      res.json({
        success: true,
        message: `${documents.length} document(s) uploaded successfully`,
        data: {
          record: withSignedRecord(record),
          uploadedDocuments: withSignedRecord(record).documents.slice(-documents.length)
        }
      });
    } catch (error) {
      console.error('Upload documents error:', error);

      // Roll back any files stored before the failure
      for (const ref of savedRefs) {
        await deleteUpload(ref);
      }

      res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Update medical record
// @route   PUT /api/medical-records/:id
// @access  Private (Doctor, Admin)
router.put('/:id', auth, authorize('doctor', 'admin'), async (req, res) => {
  try {
    let record = await MedicalRecord.findById(req.params.id);
    
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }
    
    // Check authorization
    const canEdit = 
      record.createdBy.toString() === req.user.id ||
      record.doctor?.toString() === req.user.id ||
      req.user.role === 'admin';
    
    if (!canEdit) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this record'
      });
    }
    
    // Create version before updating
    await record.createVersion(req.user.id, 'Record updated');
    
    // Update fields
    const allowedUpdates = [
      'title', 'description', 'diagnosis', 'prescriptions', 
      'labResults', 'imagingResults', 'vitalSigns', 'attachments',
      'notes', 'observations', 'followUp', 'tags', 'priority'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        record[field] = req.body[field];
      }
    });
    
    await record.save();
    
    // Log update
    const clientIp = req.ip || req.connection.remoteAddress;
    await record.logAccess(req.user.id, 'edit', clientIp);
    
    await record.populate([
      { path: 'patient', select: 'firstName lastName email' },
      { path: 'doctor', select: 'firstName lastName specialization' },
      { path: 'createdBy', select: 'firstName lastName role' }
    ]);
    
    res.json({
      success: true,
      message: 'Medical record updated successfully',
      data: { record }
    });
  } catch (error) {
    console.error('Update medical record error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Delete/Archive medical record
// @route   DELETE /api/medical-records/:id
// @access  Private (Admin only)
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }
    
    // Soft delete (archive)
    record.status = 'deleted';
    await record.save();
    
    // Log deletion
    const clientIp = req.ip || req.connection.remoteAddress;
    await record.logAccess(req.user.id, 'delete', clientIp);
    
    res.json({
      success: true,
      message: 'Medical record archived successfully'
    });
  } catch (error) {
    console.error('Delete medical record error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get all medical records for a patient
// @route   GET /api/medical-records/patient/:patientId
// @access  Private (Doctor, Staff, Receptionist, Admin)
router.get('/patient/:patientId', auth, authorize('doctor', 'staff', 'receptionist', 'patient', 'admin'), async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Check authorization - patients can only view their own records
    if (req.user.role === 'patient' && patientId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these records'
      });
    }
    
    const records = await MedicalRecord.find({ 
      patient: patientId,
      status: 'active'
    })
      .populate('doctor', 'firstName lastName specialization')
      .populate('createdBy', 'firstName lastName role')
      .populate('appointment')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: records.length,
      data: {
        records: records.map(withSignedRecord)
      }
    });
  } catch (error) {
    console.error('Get patient records error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get patient medical summary
// @route   GET /api/medical-records/patient/:patientId/summary
// @access  Private
router.get('/patient/:patientId/summary', auth, async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Check authorization
    const isAuthorized = 
      patientId === req.user.id ||
      ['doctor', 'staff', 'admin'].includes(req.user.role);
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this summary'
      });
    }
    
    const summary = await MedicalRecord.getPatientSummary(patientId);
    
    // Get latest records by type
    const latestRecords = await MedicalRecord.find({
      patient: patientId,
      status: 'active'
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('doctor', 'firstName lastName specialization')
    .select('recordType title createdAt priority');
    
    res.json({
      success: true,
      data: { 
        summary,
        latestRecords
      }
    });
  } catch (error) {
    console.error('Get patient summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
