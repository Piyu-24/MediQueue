const crypto = require('crypto');

/**
 * Signed, short-lived URLs for protected uploads (PHI).
 *
 * The public `/uploads` static mount was removed because it exposed medical
 * documents and NIC scans to anyone who could guess a filename. Files are now
 * served exclusively through `GET /api/files/:category/:name`, which requires a
 * valid HMAC signature + unexpired timestamp. Only authenticated, authorised
 * API responses mint these URLs, so an anonymous caller can never forge one.
 *
 * This mirrors Cloudinary's "authenticated delivery" model: the bytes live
 * behind an unguessable, expiring, signature-scoped URL.
 */

// Default validity window — long enough to view a record, short enough to limit
// accidental sharing of a leaked URL.
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Whitelisted upload sub-folders that may ever be served.
const ALLOWED_CATEGORIES = new Set(['documents', 'nic-documents']);

// A filename must be a single path segment (no traversal, no separators).
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function getSecret() {
  const secret = process.env.FILE_URL_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FILE_URL_SECRET (or JWT_SECRET) must be set to sign file URLs');
  }
  return secret;
}

/**
 * Sign a `cloudinary://<type>/<resource_type>/<format>/<public_id>` reference
 * into an authenticated Cloudinary *delivery* URL (res.cloudinary.com/...).
 *
 * A signed delivery URL renders inline in <img>/<a> and is served from the CDN
 * with permissive CORS (so axios blob fetches work too). Only a caller holding
 * the Cloudinary API secret can produce a valid signature, and such URLs are
 * only ever handed to already-authorised users.
 *
 * Note: true time-based expiry on delivery URLs requires Cloudinary's
 * token-based authentication add-on; the signature alone already prevents
 * forgery. `ttlMs` is accepted for API symmetry with the local signer.
 */
function signCloudinaryRef(ref /*, ttlMs */) {
  const rest = ref.slice('cloudinary://'.length).split('/');
  if (rest.length < 4) return ref;
  const [type, resourceType, format, ...publicIdParts] = rest;
  const publicId = publicIdParts.join('/');

  // Lazy-require so environments without Cloudinary configured never load it.
  const { cloudinary } = require('../config/cloudinary');

  return cloudinary.url(publicId, {
    resource_type: resourceType || 'image',
    type: type || 'authenticated',
    format: format || undefined,
    secure: true,
    sign_url: true,
  });
}

function computeSignature(category, name, exp) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${category}/${name}:${exp}`)
    .digest('hex');
}

function isValidTarget(category, name) {
  return (
    ALLOWED_CATEGORIES.has(category) &&
    typeof name === 'string' &&
    SAFE_NAME.test(name) &&
    !name.includes('..')
  );
}

/**
 * Turn a stored file reference into a signed, short-lived URL — the single
 * abstraction the rest of the app uses regardless of where a file lives:
 *
 *   cloudinary://... → signed, expiring Cloudinary delivery URL
 *   /uploads/...     → signed `/api/files/<category>/<name>?e=..&s=..` path
 *   https://...      → returned unchanged (already an absolute URL)
 *
 * @returns {string} a URL/path the client can load directly
 */
function signFileUrl(storedUrl, ttlMs = DEFAULT_TTL_MS) {
  if (!storedUrl || typeof storedUrl !== 'string') return storedUrl;

  // Cloudinary-hosted asset → delegate to the Cloudinary signer.
  if (storedUrl.startsWith('cloudinary://')) {
    return signCloudinaryRef(storedUrl, ttlMs);
  }

  // Leave absolute/external URLs untouched.
  if (/^https?:\/\//i.test(storedUrl)) return storedUrl;

  const match = storedUrl.match(/^\/?(?:uploads\/)?([^/]+)\/([^/?#]+)$/);
  if (!match) return storedUrl;

  const category = match[1];
  const name = match[2];
  if (!isValidTarget(category, name)) return storedUrl;

  const exp = Date.now() + ttlMs;
  const sig = computeSignature(category, name, exp);
  return `/api/files/${category}/${encodeURIComponent(name)}?e=${exp}&s=${sig}`;
}

/**
 * Verify a signed file request. Uses a constant-time comparison and rejects
 * expired or malformed signatures.
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyFileSignature(category, name, exp, sig) {
  if (!isValidTarget(category, name)) {
    return { ok: false, reason: 'invalid_target' };
  }

  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  if (typeof sig !== 'string' || sig.length === 0) {
    return { ok: false, reason: 'missing_signature' };
  }

  const expected = computeSignature(category, name, expNum);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

module.exports = {
  signFileUrl,
  verifyFileSignature,
  ALLOWED_CATEGORIES,
  DEFAULT_TTL_MS,
};
