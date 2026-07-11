const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const sendEmail = require('../utils/sendEmail');

// Tight rate limiter for registration and password-reset — 10 attempts per IP per hour
const authStrictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts from this IP. Please try again in an hour.' },
});

const router = express.Router();

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  path: '/',
};

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const PASSWORD_RULE = 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)';

function getClientIP(req) {
  return req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
}

async function writeAuditLog({ userId, userRole, action, resourceId, ipAddress, userAgent, status = 'SUCCESS', description, metadata }) {
  try {
    await AuditLog.createLog({
      userId,
      userRole,
      action,
      resourceType: 'User',
      resourceId: resourceId || userId,
      ipAddress: ipAddress || 'unknown',
      userAgent: userAgent || 'unknown',
      status,
      description,
      metadata,
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', authStrictLimiter, [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(PASSWORD_REGEX)
    .withMessage(PASSWORD_RULE),
  body('phone')
    .optional()
    .customSanitizer(v => (v || '').replace(/\s/g, ''))
    .matches(/^(?:0\d{9}|\+94\d{9})$/)
    .withMessage('Enter a valid phone number (e.g. 0712345678 or +94712345678)'),
  body('role')
    .optional()
    .custom((value) => !value || value === 'patient')
    .withMessage('Self-registration is only available for patient accounts')
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

    const {
      firstName, lastName, email, password, phone,
      role = 'patient', dateOfBirth, gender, bloodType, address,
      nicNumber, emergencyContact, specialization, department, licenseNumber,
      yearsOfExperience, qualification
    } = req.body;

    // ── Self-registration is for patients only ─────────────────────────────
    // Doctor, receptionist, pharmacist, and staff accounts must be created
    // by an administrator via the admin dashboard.
    if (role && role !== 'patient') {
      return res.status(403).json({
        success: false,
        message: 'Self-registration is only available for patient accounts. Healthcare staff accounts are created by hospital administration.'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Email is trusted at registration — no verification step required.
    // Verification is only triggered when a user later changes their email address.
    const userData = { firstName, lastName, email, password, phone, role: 'patient', address, isEmailVerified: true };

    if (dateOfBirth) userData.dateOfBirth = dateOfBirth;
    if (gender) userData.gender = gender;
    if (bloodType) userData.bloodType = bloodType;
    if (nicNumber) userData.nicNumber = nicNumber;
    if (emergencyContact) userData.emergencyContact = emergencyContact;
    userData.registeredBy = 'Self';
    userData.identityVerificationStatus = 'pending';

    const user = await User.create(userData);

    // Audit log for patient self-registration
    if (role === 'patient') {
      await writeAuditLog({
        userId: user._id,
        userRole: user.role,
        action: 'PATIENT_SELF_REGISTERED',
        resourceId: user._id,
        ipAddress: getClientIP(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        status: 'SUCCESS',
        description: `Patient self-registered: ${email}`,
        metadata: { nicNumber: nicNumber || null, registeredBy: 'Self' },
      });
    }

    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    user.password = undefined;

    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: { user, token }
    });

  } catch (error) {
    // MongoDB unique constraint violation — email already taken (race condition safety net)
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })
    .withMessage('Please provide a valid email address'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email, password, deviceInfo } = req.body;
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const user = await User.findOne({ email })
      .select('+password +loginAttempts +lockoutUntil +lastLogin +trustedDevices');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account is inactive' });
    }

    // Check lockout
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      const remaining = Math.ceil((user.lockoutUntil - Date.now()) / 60000);
      await writeAuditLog({
        userId: user._id, userRole: user.role, action: 'ACCOUNT_LOCKED',
        ipAddress: clientIP, userAgent, status: 'FAILURE',
        description: `Login blocked – account locked for ${remaining} more minute(s)`,
      });
      return res.status(401).json({
        success: false,
        message: `Account is temporarily locked. Try again in ${remaining} minute(s).`
      });
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 3) {
        const lockoutDuration = Math.min(300000 * Math.pow(2, user.loginAttempts - 3), 3600000);
        user.lockoutUntil = new Date(Date.now() + lockoutDuration);
      }
      await user.save();

      await writeAuditLog({
        userId: user._id, userRole: user.role, action: 'FAILED_LOGIN',
        ipAddress: clientIP, userAgent, status: 'FAILURE',
        description: `Failed login attempt ${user.loginAttempts}`,
        metadata: { attemptsRemaining: Math.max(0, 3 - user.loginAttempts) },
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        attemptsRemaining: Math.max(0, 3 - user.loginAttempts)
      });
    }

    // Successful login
    user.loginAttempts = 0;
    user.lockoutUntil = undefined;
    user.lastLogin = new Date();

    if (deviceInfo) {
      const deviceFingerprint = crypto.createHash('sha256').update(JSON.stringify(deviceInfo)).digest('hex');
      if (!user.trustedDevices) user.trustedDevices = [];
      const existingDevice = user.trustedDevices.find(d => d.fingerprint === deviceFingerprint);
      if (!existingDevice) {
        user.trustedDevices.push({
          fingerprint: deviceFingerprint,
          lastUsed: new Date(),
          trusted: false,
          userAgent: deviceInfo.userAgent,
          platform: deviceInfo.platform,
        });
      } else {
        existingDevice.lastUsed = new Date();
      }
    }

    await user.save();

    // Always use JWT_EXPIRE (15m) for access token — short-lived by design
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    user.password = undefined;
    user.loginAttempts = undefined;
    user.lockoutUntil = undefined;

    // Set refresh token as httpOnly cookie; access token returned in body
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

    await writeAuditLog({
      userId: user._id, userRole: user.role, action: 'LOGIN',
      ipAddress: clientIP, userAgent, status: 'SUCCESS',
      description: 'Successful login',
    });

    res.json({
      success: true,
      message: 'Login successful',
      user,
      token,
      requiresTwoFA: user.twoFactorEnabled
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Refresh access token (reads refresh token from httpOnly cookie or body fallback)
// @route   POST /api/auth/refresh
// @access  Public
router.post('/refresh', async (req, res) => {
  try {
    // Prefer cookie; fall back to body for clients that haven't migrated yet
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token is required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const newToken = user.generateAuthToken();
    const newRefreshToken = user.generateRefreshToken();

    res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS);

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: { token: newToken }
    });

  } catch (error) {
    res.clearCookie('refreshToken', { path: '/' });
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
});

// @desc    Re-authenticate user (lock screen / sensitive action verification)
// @route   POST /api/auth/re-authenticate
// @access  Private
router.post('/re-authenticate', auth, [
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const isPasswordValid = await user.comparePassword(req.body.password);

    if (!isPasswordValid) {
      await writeAuditLog({
        userId: user._id, userRole: user.role, action: 'REAUTH_FAILED',
        ipAddress: clientIP, userAgent, status: 'FAILURE',
        description: 'Re-authentication failed – wrong password',
      });
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    await writeAuditLog({
      userId: user._id, userRole: user.role, action: 'REAUTH_SUCCESS',
      ipAddress: clientIP, userAgent, status: 'SUCCESS',
      description: 'Re-authentication successful',
    });

    // Issue a fresh short-lived access token after re-auth
    const newToken = user.generateAuthToken();

    res.json({ success: true, message: 'Re-authentication successful', token: newToken });

  } catch (error) {
    console.error('Re-auth error:', error);
    res.status(500).json({ success: false, message: 'Server error during re-authentication' });
  }
});

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
router.get('/verify-email/:token', async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token is invalid or has expired' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Email verified successfully' });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ success: false, message: 'Server error during email verification' });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', authStrictLimiter, [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })
    .withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address', errors: errors.array() });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    // Always return the same response to prevent user enumeration.
    // Only perform the reset actions if the user actually exists.
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
      user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
      await user.save();

      const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
      try {
        await sendEmail({
          email: user.email,
          subject: 'MediQueue - Password Reset',
          message: `You requested a password reset. Click here to reset: ${resetUrl}\n\nThis link expires in 10 minutes.\n\nIf you did not request this, you can safely ignore this email.`
        });
      } catch (err) {
        // Roll back token if email fails so the user can try again
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        console.error('Password reset email failed:', err);
      }
    }

    // Return identical response whether user exists or not
    res.json({
      success: true,
      message: 'If an account with that email address exists, a password reset link has been sent. Please check your inbox.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
router.put('/reset-password/:token', [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(PASSWORD_REGEX)
    .withMessage(PASSWORD_RULE)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Password validation failed', errors: errors.array() });
    }

    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token is invalid or has expired' });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.lastPasswordChange = new Date();
    await user.save();

    await writeAuditLog({
      userId: user._id, userRole: user.role, action: 'PASSWORD_CHANGE',
      ipAddress: getClientIP(req), userAgent: req.headers['user-agent'] || 'unknown',
      status: 'SUCCESS', description: 'Password reset via email token',
    });

    res.json({ success: true, message: 'Password reset successful' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ success: true, user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Change password (authenticated user, requires current password)
// @route   POST /api/auth/change-password
// @access  Private
router.post('/change-password', auth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(PASSWORD_REGEX).withMessage(PASSWORD_RULE),
  body('confirmPassword').notEmpty().withMessage('Please confirm your new password')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New password and confirmation do not match' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isCurrentValid = await user.comparePassword(currentPassword);
    if (!isCurrentValid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from your current password' });
    }

    user.password = newPassword;
    user.lastPasswordChange = new Date();
    await user.save();

    await writeAuditLog({
      userId: user._id, userRole: user.role, action: 'PASSWORD_CHANGE',
      ipAddress: getClientIP(req), userAgent: req.headers['user-agent'] || 'unknown',
      status: 'SUCCESS', description: 'Password changed via profile settings',
    });

    // Invalidate the refresh token so all other sessions must re-authenticate
    res.clearCookie('refreshToken', { path: '/' });

    res.json({ success: true, message: 'Password updated successfully. Please sign in again.' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error during password change' });
  }
});

// @desc    Resend email verification
// @route   POST /api/auth/resend-verification
// @access  Private
router.post('/resend-verification', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Your email address is already verified.' });
    }

    // Cooldown: block if a token was issued less than 2 minutes ago
    const COOLDOWN_MS = 2 * 60 * 1000;
    const cooldownBoundary = Date.now() + 24 * 60 * 60 * 1000 - COOLDOWN_MS;
    if (user.emailVerificationExpires && user.emailVerificationExpires > cooldownBoundary) {
      const canRetryAt   = user.emailVerificationExpires - 24 * 60 * 60 * 1000 + COOLDOWN_MS;
      const waitSeconds  = Math.max(1, Math.ceil((canRetryAt - Date.now()) / 1000));
      return res.status(429).json({
        success: false,
        message: `A verification email was sent recently. Please wait ${waitSeconds} second${waitSeconds === 1 ? '' : 's'} before requesting another.`,
        retryAfterSeconds: waitSeconds,
      });
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken  = crypto.createHash('sha256').update(emailVerificationToken).digest('hex');
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    await user.save();

    const verificationUrl = `${process.env.CLIENT_URL}/verify-email/${emailVerificationToken}`;
    try {
      await sendEmail({
        email:   user.email,
        subject: 'MediQueue - Verify Your Email Address',
        message: `Please verify your email address by clicking the link below:\n\n${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create a MediQueue account, you can safely ignore this email.`,
      });
    } catch (err) {
      console.error('Resend verification email failed:', err);
      // Roll back token so the cooldown does not lock the user out after a send failure
      user.emailVerificationToken   = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();
      return res.status(500).json({
        success: false,
        message: 'Failed to send the verification email. Please try again in a moment.',
      });
    }

    res.json({ success: true, message: `Verification email sent to ${user.email}. Please check your inbox.` });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', auth, async (req, res) => {
  try {
    await writeAuditLog({
      userId: req.user._id, userRole: req.user.role, action: 'LOGOUT',
      ipAddress: getClientIP(req), userAgent: req.headers['user-agent'] || 'unknown',
      status: 'SUCCESS', description: 'User logged out',
    });

    res.clearCookie('refreshToken', { path: '/' });
    res.json({ success: true, message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
