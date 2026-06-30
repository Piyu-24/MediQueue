const express    = require('express');
const { body, validationResult } = require('express-validator');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const User       = require('../models/User');
const AuditLog   = require('../models/AuditLog');
const auth       = require('../middleware/auth');
const authorize  = require('../middleware/authorize');
const sendEmail  = require('../utils/sendEmail');

async function writeAuditLog({ userId, userRole, action, resourceId, ipAddress, userAgent, status = 'SUCCESS', description, metadata }) {
  try {
    await AuditLog.createLog({
      userId, userRole, action,
      resourceType: 'User',
      resourceId: resourceId || userId,
      ipAddress: ipAddress || 'unknown',
      userAgent: userAgent || 'unknown',
      status, description, metadata,
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

const router = express.Router();

// Configure multer for NIC uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../uploads/nic-documents');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, 'nic-' + req.user.id + '-' + uniqueSuffix + extension);
  }
});

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

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Filter returned fields based on role
    const filteredUser = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      phoneNumber: user.phoneNumber,
      address: user.address,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      identityVerificationStatus: user.identityVerificationStatus,
      digitalHealthCardId: user.digitalHealthCardId
    };

    if (user.role === 'patient') {
      filteredUser.medicalInfo = user.medicalInfo;
    } else if (user.role === 'doctor') {
      filteredUser.specialization = user.specialization;
      filteredUser.licenseNumber = user.licenseNumber;
      filteredUser.department = user.department;
      filteredUser.yearsOfExperience = user.yearsOfExperience;
      filteredUser.consultationFee = user.consultationFee;
      filteredUser.bio = user.bio;
      filteredUser.languages = user.languages;
      filteredUser.workingDays = user.workingDays;
      filteredUser.workingHours = user.workingHours;
      filteredUser.qualifications = user.qualifications;
      filteredUser.availability = user.availability;
      filteredUser.experience = user.experience;
    }

    res.json({
      success: true,
      data: { user: filteredUser }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put('/profile', auth, [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().matches(/^\+?[\d\s-()]+$/),
  body('dateOfBirth').optional().isISO8601(),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer-not-to-say'])
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

    // Filter allowed fields based on role
    const allowedSharedFields = ['firstName', 'lastName', 'phone', 'address', 'dateOfBirth', 'gender'];
    const updateData = {};

    allowedSharedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    if (req.user.role === 'patient') {
      const allowedPatientFields = ['medicalInfo'];
      allowedPatientFields.forEach(field => {
        if (req.body[field] !== undefined) updateData[field] = req.body[field];
      });
    } else if (req.user.role === 'doctor') {
      const allowedDoctorFields = [
        'specialization', 'licenseNumber', 'department', 'yearsOfExperience',
        'consultationFee', 'bio', 'languages', 'workingDays', 'workingHours',
        'qualifications', 'availability', 'experience'
      ];
      allowedDoctorFields.forEach(field => {
        if (req.body[field] !== undefined) updateData[field] = req.body[field];
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Upload NIC document for identity verification
// @route   POST /api/users/upload-nic
// @access  Private (Patient)
router.post('/upload-nic', auth, upload.single('nicDocument'), async (req, res) => {
  try {
    console.log('NIC upload request from user:', req.user?.id, 'role:', req.user?.role);
    console.log('File received:', req.file?.filename);
    console.log('NIC Number:', req.body?.nicNumber);
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { nicNumber } = req.body;

    if (!nicNumber) {
      // Delete uploaded file if NIC number is missing
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'NIC number is required'
      });
    }

    // Delete old NIC document if exists
    const oldUser = await User.findById(req.user.id);
    if (oldUser.nicDocument && oldUser.nicDocument.path) {
      const oldPath = path.join(__dirname, '..', oldUser.nicDocument.path);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Update user with NIC document info
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        nicDocument: {
          filename: req.file.filename,
          path: req.file.path,
          uploadedAt: new Date(),
          mimetype: req.file.mimetype
        },
        nicNumber: nicNumber,
        identityVerificationStatus: 'pending',
        verificationNote: ''
      },
      { new: true, runValidators: true }
    );

    console.log('NIC uploaded successfully for user:', user._id);

    res.json({
      success: true,
      message: 'NIC document uploaded successfully. Awaiting verification.',
      data: { 
        user,
        verificationStatus: 'pending'
      }
    });
  } catch (error) {
    console.error('Upload NIC error:', error);
    
    // Delete uploaded file on error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get NIC verification status
// @route   GET /api/users/nic-status
// @access  Private (Patient)
router.get('/nic-status', auth, async (req, res) => {
  try {
    console.log('NIC status request from user:', req.user?.id, 'role:', req.user?.role);
    
    const user = await User.findById(req.user.id).select('identityVerificationStatus verificationNote nicNumber nicDocument');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        status: user.identityVerificationStatus || 'unverified',
        note: user.verificationNote || '',
        nicNumber: user.nicNumber || '',
        hasDocument: !!user.nicDocument
      }
    });
  } catch (error) {
    console.error('Get NIC status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get NIC document image
// @route   GET /api/users/nic-document/:patientId
// @access  Private (Manager, Staff, Receptionist)
router.get('/nic-document/:patientId', auth, authorize('staff', 'receptionist', 'admin'), async (req, res) => {
  try {
    console.log('Fetching NIC document for patient:', req.params.patientId);
    
    const patient = await User.findById(req.params.patientId);
    
    if (!patient) {
      console.log('Patient not found');
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }
    
    if (!patient.nicDocument || !patient.nicDocument.path) {
      console.log('NIC document not found for patient');
      return res.status(404).json({
        success: false,
        message: 'NIC document not found'
      });
    }

    console.log('Serving NIC document:', patient.nicDocument.path);
    
    // Check if file exists
    if (!fs.existsSync(patient.nicDocument.path)) {
      console.log('File does not exist at path:', patient.nicDocument.path);
      return res.status(404).json({
        success: false,
        message: 'NIC document file not found'
      });
    }

    // Set appropriate content type
    res.setHeader('Content-Type', patient.nicDocument.mimetype || 'image/jpeg');
    
    // Send the file using absolute path
    res.sendFile(path.resolve(patient.nicDocument.path));
  } catch (error) {
    console.error('Get NIC document error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get all doctors
// @route   GET /api/users/doctors
// @access  Public
router.get('/doctors', async (req, res) => {
  try {
    const { specialization, department, search } = req.query;
    
    let query = { role: 'doctor', isActive: true };
    
    if (specialization) {
      query.specialization = new RegExp(specialization, 'i');
    }
    
    if (department) {
      query.department = new RegExp(department, 'i');
    }
    
    if (search) {
      query.$or = [
        { firstName: new RegExp(search, 'i') },
        { lastName: new RegExp(search, 'i') },
        { specialization: new RegExp(search, 'i') }
      ];
    }

    const doctors = await User.find(query)
      .select('-password')
      .sort({ firstName: 1 });

    res.json({
      success: true,
      count: doctors.length,
      data: { doctors }
    });
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get doctor by ID
// @route   GET /api/users/doctors/:id
// @access  Public
router.get('/doctors/:id', async (req, res) => {
  try {
    const doctor = await User.findOne({
      _id: req.params.id,
      role: 'doctor',
      isActive: true
    }).select('-password');

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    res.json({
      success: true,
      data: { doctor }
    });
  } catch (error) {
    console.error('Get doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user profile by ID
// @route   GET /api/users/:id/profile
// @access  Private
router.get('/:id/profile', auth, async (req, res) => {
  try {
    // Check if user is accessing their own profile or is admin/manager
    if (req.user.id !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user profile by ID
// @route   PUT /api/users/:id/profile
// @access  Private
router.put('/:id/profile', auth, [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().matches(/^\+?[\d\s-()]+$/),
  body('dateOfBirth').optional().isISO8601(),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer-not-to-say']),
  body('availability').optional().isObject(),
  body('email').optional().isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Invalid email address')
], async (req, res) => {
  try {
    // Check if user is updating their own profile or is admin/manager
    if (req.user.id !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Allowlisted fields — never accept role, isActive, password, or verification status from body
    const SHARED_FIELDS = ['firstName', 'lastName', 'phone', 'phoneNumber', 'address', 'dateOfBirth', 'gender'];
    const DOCTOR_FIELDS = [
      'specialization', 'department', 'licenseNumber', 'yearsOfExperience',
      'qualification', 'qualifications', 'consultationFee', 'bio',
      'languages', 'workingDays', 'workingHours', 'availability', 'experience',
    ];
    const STAFF_FIELDS  = ['department', 'employeeId', 'joiningDate'];

    const targetUser = await User.findById(req.params.id).select('role');
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const allowedFields = [...SHARED_FIELDS];
    if (targetUser.role === 'doctor')                                         allowedFields.push(...DOCTOR_FIELDS);
    if (['staff', 'receptionist', 'pharmacist', 'admin'].includes(targetUser.role)) allowedFields.push(...STAFF_FIELDS);
    if (targetUser.role === 'patient')                                        allowedFields.push('medicalInfo', 'emergencyContact');

    const updateData = {};
    allowedFields.forEach(f => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    // Email change — patients only, with uniqueness check + verification token + email send
    let pendingVerificationEmail = null; // { to, url } — set when an email needs sending
    if (targetUser.role === 'patient' && req.body.email !== undefined) {
      const newEmail = req.body.email.trim().toLowerCase();
      const current  = await User.findById(req.params.id).select('email');
      if (current && newEmail !== current.email) {
        const taken = await User.findOne({ email: newEmail, _id: { $ne: req.params.id } });
        if (taken) {
          return res.status(409).json({ success: false, message: 'This email address is already in use.' });
        }
        // Generate a fresh verification token for the new address
        const rawToken    = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

        updateData.email                   = newEmail;
        updateData.isEmailVerified         = false;
        updateData.emailVerificationToken  = hashedToken;
        updateData.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;

        pendingVerificationEmail = {
          to:  newEmail,
          url: `${process.env.CLIENT_URL}/verify-email/${rawToken}`,
        };
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Send verification email to the new address (after DB write succeeds)
    let emailVerificationSent = false;
    if (pendingVerificationEmail) {
      try {
        await sendEmail({
          email:   pendingVerificationEmail.to,
          subject: 'MediQueue — Verify Your New Email Address',
          message: `Your MediQueue email address has been changed.\n\nPlease verify your new address by clicking the link below:\n\n${pendingVerificationEmail.url}\n\nThis link expires in 24 hours.\n\nIf you did not request this change, please contact us immediately.`,
        });
        emailVerificationSent = true;
      } catch (emailErr) {
        console.error('Verification email send failed:', emailErr.message);
        // Roll back the token so the resend-verification cooldown does not block the user
        await User.findByIdAndUpdate(req.params.id, {
          $unset: { emailVerificationToken: 1, emailVerificationExpires: 1 },
        });
      }
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user, emailVerificationSent },
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Search users (Admin/Manager/Receptionist)
// @route   GET /api/users/search
// @access  Private (Admin/Manager/Staff/Receptionist)
router.get('/search', auth, authorize('admin', 'staff', 'receptionist'), async (req, res) => {
  try {
    // Support both 'q' and 'query' parameters for backwards compatibility
    const searchQuery = req.query.q || req.query.query || '';
    const { role, isActive } = req.query;

    // Build search filter — empty query returns all users
    const searchFilter = searchQuery.trim()
      ? {
          $or: [
            { firstName: { $regex: searchQuery, $options: 'i' } },
            { lastName: { $regex: searchQuery, $options: 'i' } },
            { email: { $regex: searchQuery, $options: 'i' } },
            { phone: { $regex: searchQuery, $options: 'i' } },
            { digitalHealthCardId: { $regex: searchQuery, $options: 'i' } },
            { nicNumber: { $regex: searchQuery, $options: 'i' } }
          ]
        }
      : {};
    
    if (role) {
      searchFilter.role = role;
    }
    
    if (isActive !== undefined) {
      searchFilter.isActive = isActive === 'true';
    }

    const users = await User.find(searchFilter)
      .select('-password -resetPasswordToken -resetPasswordExpire')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      count: users.length,
      data: { users }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get patients for identity verification
// @route   GET /api/users/patients/verification
// @access  Private (Manager, Staff, Receptionist)
router.get('/patients/verification', auth, authorize('staff', 'receptionist', 'admin'), async (req, res) => {
  try {
    const { status } = req.query;
    
    const filters = { role: 'patient', isActive: true };
    if (status) {
      filters.identityVerificationStatus = status;
    }

    const patients = await User.find(filters)
      .select('firstName lastName email phone dateOfBirth nicNumber nicDocument identityVerificationStatus verificationNote verifiedBy verifiedAt registeredBy verificationMethod createdAt')
      .populate('verifiedBy', 'firstName lastName role')
      .sort({ createdAt: -1 });

    console.log(`Found ${patients.length} patients for verification`);
    
    res.json({
      success: true,
      count: patients.length,
      data: patients
    });
  } catch (error) {
    console.error('Get patients for verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Verify patient identity
// @route   PUT /api/users/patients/:id/verify-identity
// @access  Private (Staff, Receptionist, Admin)
router.put('/patients/:id/verify-identity', auth, authorize('staff', 'receptionist', 'admin'), async (req, res) => {
  try {
    const { verificationStatus, verificationNote, verificationMethod = 'NIC_SEEN' } = req.body;

    if (!['verified', 'rejected', 'pending'].includes(verificationStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification status'
      });
    }

    const updateFields = {
      identityVerificationStatus: verificationStatus,
      verificationNote: verificationNote || '',
      verifiedBy: req.user.id,
      verifiedAt: new Date(),
    };

    // Only record verificationMethod when actually verifying (not when resetting to pending)
    if (verificationStatus === 'verified') {
      updateFields.verificationMethod = verificationMethod;
    }

    const patient = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'patient' },
      updateFields,
      { new: true, runValidators: true }
    ).select('firstName lastName email identityVerificationStatus verificationNote verificationMethod');

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Audit log
    await writeAuditLog({
      userId:      req.user.id,
      userRole:    req.user.role,
      action:      verificationStatus === 'verified' ? 'VERIFY_IDENTITY' : 'REJECT_IDENTITY',
      resourceId:  patient._id,
      ipAddress:   req.ip,
      userAgent:   req.headers['user-agent'],
      status:      'SUCCESS',
      description: `Patient identity ${verificationStatus} for ${patient.firstName} ${patient.lastName}`,
      metadata: {
        patientId:          patient._id.toString(),
        verificationStatus,
        verificationMethod: verificationStatus === 'verified' ? verificationMethod : null,
      },
    });

    res.json({
      success: true,
      message: `Patient identity ${verificationStatus} successfully`,
      data: patient
    });
  } catch (error) {
    console.error('Verify patient identity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Verify patient by Health Card ID
// @route   GET /api/users/verify-health-card/:healthCardId
// @access  Private (Staff, Manager, Receptionist)
router.get('/verify-health-card/:healthCardId', auth, authorize('staff', 'receptionist', 'admin'), async (req, res) => {
  try {
    const { healthCardId } = req.params;

    if (!healthCardId) {
      return res.status(400).json({
        success: false,
        message: 'Health Card ID is required'
      });
    }

    const patient = await User.findOne({
      digitalHealthCardId: healthCardId,
      role: 'patient'
    }).select('-password -resetPasswordToken -resetPasswordExpire');

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found with this Health Card ID'
      });
    }

    // Check identity verification status
    const verificationStatus = {
      isVerified: patient.identityVerificationStatus === 'verified',
      status: patient.identityVerificationStatus,
      hasNicDocument: !!patient.nicDocument,
      nicNumber: patient.nicNumber
    };

    res.json({
      success: true,
      data: {
        patient,
        verification: verificationStatus
      }
    });
  } catch (error) {
    console.error('Verify health card error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Create a staff/doctor/pharmacist user account (admin only)
// @route   POST /api/users/staff
// @access  Private (Admin only)
router.post('/staff', auth, authorize('admin'), [
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }),
  body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).matches(/^\+?[\d\s\-()]+$/).withMessage('Invalid phone number'),
  body('role').isIn(['doctor', 'staff', 'receptionist', 'pharmacist', 'admin']).withMessage('Invalid role'),
  body('department').optional({ checkFalsy: true }).trim(),
  body('specialization').optional({ checkFalsy: true }).trim(),
  // Doctor & pharmacist: license required
  body('licenseNumber')
    .if(body('role').isIn(['doctor', 'pharmacist']))
    .notEmpty().withMessage('License number is required for doctors and pharmacists')
    .matches(/^[A-Z0-9\/\-]+$/i).withMessage('License number may only contain letters, numbers, hyphens and slashes'),
  // Doctor-only fields
  body('qualification').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('yearsOfExperience')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 60 }).withMessage('Years of experience must be between 0 and 60'),
  body('consultationFee')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 }).withMessage('Consultation fee must be a positive number'),
  body('bio').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  body('employeeId').optional({ checkFalsy: true }).trim(),
  body('joiningDate').optional({ checkFalsy: true }).isISO8601().withMessage('Invalid joining date'),
  body('password').optional({ checkFalsy: true })
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage('Password must contain uppercase, lowercase, number and special character (@$!%*?&)')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  try {
    const {
      firstName, lastName, email, phone, role, department, specialization, password,
      licenseNumber, qualification, yearsOfExperience, consultationFee, bio, employeeId, joiningDate,
    } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Auto-generate a policy-compliant password if none provided
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const specials = '@$!%*?&';
    const rand = (s) => s[Math.floor(Math.random() * s.length)];
    const autoPassword = password || (
      rand(upper) + rand(upper) +
      rand(chars) + rand(chars) + rand(chars) +
      rand(digits) + rand(digits) +
      rand(specials)
    );

    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(autoPassword, 10);

    const userData = {
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email,
      password:  hashed,
      role,
      isActive:        true,
      isEmailVerified: true,
      identityVerificationStatus: 'verified',
      // Professional credentials start as pending — admin must verify externally
      credentialVerificationStatus: (role === 'doctor' || role === 'pharmacist') ? 'pending' : 'verified',
    };

    // Common optional fields
    if (phone)      userData.phone      = phone.trim();
    if (department) userData.department = department.trim();
    if (employeeId) userData.employeeId = employeeId.trim();
    if (joiningDate) userData.joiningDate = joiningDate;

    // Doctor-specific fields
    if (role === 'doctor') {
      if (specialization)    userData.specialization    = specialization.trim();
      if (licenseNumber)     userData.licenseNumber     = licenseNumber.trim().toUpperCase();
      if (qualification)     userData.qualification     = qualification.trim();
      if (yearsOfExperience !== undefined && yearsOfExperience !== '') {
        userData.yearsOfExperience = Number(yearsOfExperience);
      }
      if (consultationFee !== undefined && consultationFee !== '') {
        userData.consultationFee = Number(consultationFee);
      }
      if (bio) userData.bio = bio.trim();
    }

    // Pharmacist fields
    if (role === 'pharmacist') {
      if (licenseNumber) userData.licenseNumber = licenseNumber.trim().toUpperCase();
      userData.department = department?.trim() || 'Pharmacy';
    }

    const user = await User.create(userData);

    await writeAuditLog({
      userId:      req.user.id,
      userRole:    req.user.role,
      action:      'CREATE_STAFF_USER',
      resourceId:  user._id,
      ipAddress:   req.ip,
      userAgent:   req.headers['user-agent'],
      status:      'SUCCESS',
      description: `Admin created ${role} account for ${email}`,
      metadata:    { createdRole: role, createdUserId: user._id.toString() },
    });

    res.status(201).json({
      success: true,
      message: `Account created for ${firstName} ${lastName}.`,
      data: {
        user: {
          _id:       user._id,
          firstName: user.firstName,
          lastName:  user.lastName,
          email:     user.email,
          role:      user.role,
          isActive:  user.isActive,
          createdAt: user.createdAt,
          credentialVerificationStatus: user.credentialVerificationStatus,
        },
        temporaryPassword: password ? null : autoPassword,
      }
    });
  } catch (err) {
    console.error('Create staff user error:', err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// @desc    Toggle user active status
// @route   PATCH /api/users/:id/toggle-status
// @access  Private (Admin only)
router.patch('/:id/toggle-status', auth, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Prevent admin from deactivating themselves
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { userId: user._id, isActive: user.isActive }
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

module.exports = router;