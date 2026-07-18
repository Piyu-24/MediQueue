const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const auth = require('../middleware/auth');
const { signFileUrl } = require('../utils/signedFileUrl');
const { saveUpload, deleteUpload, isCloudinaryRef } = require('../utils/fileStorage');

// Swap the document's stored path for a short-lived signed URL before sending it
function withSignedUrl(document) {
  if (!document) return document;
  const obj = typeof document.toObject === 'function' ? document.toObject() : { ...document };
  if (obj.fileUrl) obj.fileUrl = signFileUrl(obj.fileUrl);
  return obj;
}

// Keep uploads in memory; saveUpload() stores them afterwards
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: fileFilter
});

// @desc    Upload document
// @route   POST /api/documents/upload
// @access  Private (All authenticated users)
router.post('/upload', auth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const {
      patientId,
      title,
      description,
      documentType,
      appointmentId,
      medicalRecordId,
      tags
    } = req.body;

    // If user is patient, they can only upload for themselves
    const targetPatientId = req.user.role === 'patient' ? req.user.id : patientId;

    if (!targetPatientId) {
      return res.status(400).json({
        success: false,
        message: 'Patient ID is required'
      });
    }

    // Save the file and get a reference to it
    const saved = await saveUpload(req.file, { folder: 'documents', prefix: 'document' });

    // fileUrl/filePath store the stored path; it's signed only when read back
    const document = new Document({
      patient: targetPatientId,
      uploadedBy: req.user.id,
      appointment: appointmentId || null,
      medicalRecord: medicalRecordId || null,
      title: title || req.file.originalname,
      description: description || '',
      documentType: documentType || 'other',
      fileName: saved.publicId,
      originalName: req.file.originalname,
      filePath: saved.ref,
      fileSize: saved.size,
      mimeType: saved.mimeType,
      fileUrl: saved.ref,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });

    try {
      await document.save();
    } catch (dbErr) {
      await deleteUpload(saved.ref); // roll back the stored file
      throw dbErr;
    }

    // Populate references
    await document.populate([
      { path: 'patient', select: 'firstName lastName email' },
      { path: 'uploadedBy', select: 'firstName lastName role' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: { document: withSignedUrl(document) }
    });

  } catch (error) {
    console.error('Upload document error:', error);

    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get documents for a patient
// @route   GET /api/documents/patient/:patientId
// @access  Private (Patient own docs, Staff, Doctor, Admin)
router.get('/patient/:patientId', auth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { documentType, page = 1, limit = 10 } = req.query;

    // Check authorization
    if (req.user.role === 'patient' && req.user.id !== patientId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these documents'
      });
    }

    let query = { 
      patient: patientId,
      status: 'active'
    };

    if (documentType) {
      query.documentType = documentType;
    }

    const documents = await Document.find(query)
      .populate('uploadedBy', 'firstName lastName role')
      .populate('appointment', 'appointmentDate appointmentTime')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Document.countDocuments(query);

    res.json({
      success: true,
      data: {
        documents: documents.map(withSignedUrl),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get single document
// @route   GET /api/documents/:id
// @access  Private (Authorized users only)
router.get('/:id', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('patient', 'firstName lastName email')
      .populate('uploadedBy', 'firstName lastName role')
      .populate('appointment', 'appointmentDate appointmentTime')
      .populate('medicalRecord', 'diagnosis');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check access permission
    if (!document.hasAccess(req.user.id, req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this document'
      });
    }

    // Log access
    await document.logAccess(req.user.id, 'view', req.ip);

    res.json({
      success: true,
      data: { document: withSignedUrl(document) }
    });

  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Download document
// @route   GET /api/documents/:id/download
// @access  Private (Authorized users only)
router.get('/:id/download', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check access permission
    if (!document.hasAccess(req.user.id, req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to download this document'
      });
    }

    // Log access
    await document.logAccess(req.user.id, 'download', req.ip);

    // Old records stored a full disk path, so send those directly.
    // Newer ones redirect to a signed URL.
    if (!isCloudinaryRef(document.filePath) && path.isAbsolute(document.filePath) && fs.existsSync(document.filePath)) {
      res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
      res.setHeader('Content-Type', document.mimeType);
      return res.sendFile(path.resolve(document.filePath));
    }

    return res.redirect(signFileUrl(document.fileUrl));

  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Share document with user
// @route   POST /api/documents/:id/share
// @access  Private (Patient own docs, Staff, Admin)
router.post('/:id/share', auth, async (req, res) => {
  try {
    const { userId, permissions = 'view' } = req.body;

    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check if user can share this document
    const canShare = document.patient.toString() === req.user.id || 
                    ['staff', 'admin'].includes(req.user.role);

    if (!canShare) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to share this document'
      });
    }

    await document.shareWith(userId, permissions);

    res.json({
      success: true,
      message: 'Document shared successfully'
    });

  } catch (error) {
    console.error('Share document error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Delete document
// @route   DELETE /api/documents/:id
// @access  Private (Patient own docs, Staff, Admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check if user can delete this document
    const canDelete = document.patient.toString() === req.user.id || 
                     document.uploadedBy.toString() === req.user.id ||
                     ['staff', 'admin'].includes(req.user.role);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this document'
      });
    }

    // Soft delete - mark as deleted
    document.status = 'deleted';
    await document.save();

    // Log access
    await document.logAccess(req.user.id, 'delete', req.ip);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get document types
// @route   GET /api/documents/types
// @access  Private
router.get('/meta/types', auth, (req, res) => {
  const documentTypes = [
    { value: 'lab-report', label: 'Lab Report' },
    { value: 'prescription', label: 'Prescription' },
    { value: 'x-ray', label: 'X-Ray' },
    { value: 'mri-scan', label: 'MRI Scan' },
    { value: 'ct-scan', label: 'CT Scan' },
    { value: 'ultrasound', label: 'Ultrasound' },
    { value: 'ecg', label: 'ECG' },
    { value: 'blood-test', label: 'Blood Test' },
    { value: 'insurance-card', label: 'Insurance Card' },
    { value: 'id-proof', label: 'ID Proof' },
    { value: 'medical-certificate', label: 'Medical Certificate' },
    { value: 'discharge-summary', label: 'Discharge Summary' },
    { value: 'vaccination-record', label: 'Vaccination Record' },
    { value: 'other', label: 'Other' }
  ];

  res.json({
    success: true,
    data: { documentTypes }
  });
});

module.exports = router;
