/**
 * Credential-verification gate.
 *
 * Clinical staff (doctor, pharmacist, receptionist, staff) may only reach
 * protected clinical routes once an administrator has verified their
 * professional credentials (credentialVerificationStatus === 'verified').
 *
 * This is the second half of the C-2 fix: even if an account somehow holds a
 * clinical role, it cannot touch patient data until an admin has vetted it.
 *
 * - Admins bypass the gate (they perform the verification).
 * - Patients are not subject to credential verification.
 * - Must run AFTER the `auth` middleware (relies on req.user).
 */
const CLINICAL_ROLES = ['doctor', 'pharmacist', 'receptionist', 'staff'];

const requireVerifiedCredentials = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
    });
  }

  // Non-clinical roles (admin, patient) are not credential-gated.
  if (!CLINICAL_ROLES.includes(req.user.role)) {
    return next();
  }

  if (req.user.credentialVerificationStatus === 'verified') {
    return next();
  }

  return res.status(403).json({
    success: false,
    code: 'CREDENTIALS_NOT_VERIFIED',
    message:
      'Your professional credentials are pending administrator verification. ' +
      'You will be able to access clinical features once an admin approves your account.',
  });
};

module.exports = requireVerifiedCredentials;
module.exports.CLINICAL_ROLES = CLINICAL_ROLES;
