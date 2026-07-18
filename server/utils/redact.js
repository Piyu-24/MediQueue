// Keys whose values must never appear in logs (passwords, tokens, PHI, secrets).
// Compared case-insensitively.
const SENSITIVE_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'confirmpassword', 'oldpassword',
  'token', 'refreshtoken', 'accesstoken', 'resettoken', 'emailverificationtoken',
  'passwordresettoken', 'otp', 'twofactorsecret', 'twofactorcode', 'secret',
  'apikey', 'authorization', 'cookie',
  'nicnumber', 'cardnumber', 'cvv', 'ssn',
]);

/**
 * Return a deep copy of a value with sensitive fields masked, safe for logging.
 * Never mutates the input. Bounded depth to avoid huge/cyclic structures.
 */
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
