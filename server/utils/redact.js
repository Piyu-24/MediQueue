// Keys whose values must never appear in logs (passwords, tokens, PHI, secrets).
// Compared case-insensitively.
const SENSITIVE_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'confirmpassword', 'oldpassword',
  'token', 'refreshtoken', 'accesstoken', 'resettoken', 'emailverificationtoken',
  'passwordresettoken', 'otp', 'twofactorsecret', 'twofactorcode', 'secret',
  'apikey', 'authorization', 'cookie',
  'nicnumber', 'cardnumber', 'cvv', 'ssn',
]);

// Return a copy with sensitive fields masked, safe to log.
// Doesn't change the original, and stops after a few levels deep.
function redactSensitive(value, depth = 0) {
  if (value == null || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactSensitive(v, depth + 1);
    }
    return out;
  }
  return value;
}

module.exports = { redactSensitive, SENSITIVE_KEYS };
