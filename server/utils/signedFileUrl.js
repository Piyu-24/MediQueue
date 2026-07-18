const crypto = require('crypto');

// Makes signed, short-lived URLs for protected uploads (medical files, NIC scans).
// Files are only served through GET /api/files/:category/:name, which needs a
// valid signature and an unexpired timestamp, so nobody can just guess a filename.

// How long a signed URL stays valid
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Only these upload folders can ever be served
const ALLOWED_CATEGORIES = new Set(['documents', 'nic-documents']);

// A filename must be a single safe segment (no slashes, no ..)
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function getSecret() {
  const secret = process.env.FILE_URL_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FILE_URL_SECRET (or JWT_SECRET) must be set to sign file URLs');
  }
  return secret;
}

// Turn a cloudinary:// reference into a signed Cloudinary URL.
// Only someone with the Cloudinary secret can make a valid signature.
function signCloudinaryRef(ref /*, ttlMs */) {
  const rest = ref.slice('cloudinary://'.length).split('/');
  if (rest.length < 4) return ref;
  const [type, resourceType, format, ...publicIdParts] = rest;
  const publicId = publicIdParts.join('/');

  // Require here so setups without Cloudinary never load it
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

// Turn a stored file reference into a signed URL the client can load.
// Handles cloudinary:// refs, /uploads/... paths, and leaves full URLs alone.
function signFileUrl(storedUrl, ttlMs = DEFAULT_TTL_MS) {
  if (!storedUrl || typeof storedUrl !== 'string') return storedUrl;

  // Cloudinary file - use the Cloudinary signer
  if (storedUrl.startsWith('cloudinary://')) {
    return signCloudinaryRef(storedUrl, ttlMs);
  }

  // Leave full external URLs as they are
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

// Check a signed file request. Rejects expired or bad signatures.
// Uses a constant-time compare so timing can't leak the signature.
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
