// Blocks clinical staff from clinical routes until an admin has verified their
// credentials. Admins and patients are not affected. Must run after auth.
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
