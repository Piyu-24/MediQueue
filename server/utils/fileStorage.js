const path = require('path');
const fs = require('fs');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

/**
 * Provider-agnostic upload storage.
 *
 * Returns a canonical *reference string* that is stored in MongoDB. The rest of
 * the app never needs to know where a file physically lives — `signFileUrl()`
 * turns the reference into a signed, short-lived URL on read.
 *
 *   Cloudinary : cloudinary://<type>/<resource_type>/<format>/<public_id>
 *   Local disk : /uploads/<folder>/<filename>
 *
 * Cloudinary is used whenever it is configured (required on ephemeral hosts like
 * Vercel where local disk does not persist); otherwise it falls back to local
 * disk so development works without Cloudinary credentials.
 */

const UPLOADS_ROOT = path.resolve(__dirname, '..', 'uploads');

function buildCloudinaryRef({ type, resource_type, format, public_id }) {
  return `cloudinary://${type}/${resource_type}/${format || ''}/${public_id}`;
}

/** Parse a cloudinary:// reference back into its parts. Returns null if not one. */
function parseCloudinaryRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('cloudinary://')) return null;
  const rest = ref.slice('cloudinary://'.length);
  const parts = rest.split('/');
  if (parts.length < 4) return null;
  const [type, resourceType, format, ...publicIdParts] = parts;
  return {
    type,
    resourceType,
    format: format || undefined,
    publicId: publicIdParts.join('/'),
  };
}

function isCloudinaryRef(ref) {
  return typeof ref === 'string' && ref.startsWith('cloudinary://');
}

function uploadBufferToCloudinary(buffer, { folder }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `mediqueue/${folder}`,
        resource_type: 'auto',
        type: 'authenticated', // private — only reachable via a signed URL
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

function saveToDisk(buffer, { folder, prefix, originalname }) {
  const dir = path.join(UPLOADS_ROOT, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(originalname || '');
  const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${folder}/${filename}`;
}

/**
 * Persist an in-memory multer file and return a canonical reference + metadata.
 * @param {{buffer:Buffer, originalname:string, mimetype:string, size:number}} file
 * @param {{folder:string, prefix?:string}} opts
 */
async function saveUpload(file, { folder, prefix = 'file' }) {
  if (isCloudinaryConfigured) {
    const result = await uploadBufferToCloudinary(file.buffer, { folder });
    return {
      ref: buildCloudinaryRef(result),
      provider: 'cloudinary',
      publicId: result.public_id,
      size: result.bytes,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  }

  const ref = saveToDisk(file.buffer, { folder, prefix, originalname: file.originalname });
  return {
    ref,
    provider: 'local',
    publicId: ref,
    size: file.size,
    mimeType: file.mimetype,
    originalName: file.originalname,
  };
}

/** Best-effort delete of a stored file (used on error rollback / replacement). */
async function deleteUpload(ref) {
  try {
    const cl = parseCloudinaryRef(ref);
    if (cl) {
      await cloudinary.uploader.destroy(cl.publicId, {
        resource_type: cl.resourceType,
        type: cl.type,
      });
      return;
    }
    if (typeof ref === 'string' && ref.startsWith('/uploads/')) {
      const abs = path.resolve(UPLOADS_ROOT, '..', '.' + ref);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  } catch (err) {
    console.error('deleteUpload failed for', ref, '-', err.message);
  }
}

module.exports = {
  saveUpload,
  deleteUpload,
  parseCloudinaryRef,
  isCloudinaryRef,
  isCloudinaryConfigured,
};
