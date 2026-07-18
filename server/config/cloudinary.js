const { v2: cloudinary } = require('cloudinary');

// Cloudinary setup for private uploads.
// Files are uploaded as 'authenticated' so they aren't public - they can only
// be reached through a signed URL (see utils/signedFileUrl.js).

function isPlaceholder(v) {
  return !v || /^your_/i.test(String(v).trim());
}

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isCloudinaryConfigured =
  !isPlaceholder(cloudName) && !isPlaceholder(apiKey) && !isPlaceholder(apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

module.exports = { cloudinary, isCloudinaryConfigured };
