const express = require('express');
const path = require('path');
const fs = require('fs');
const { verifyFileSignature } = require('../utils/signedFileUrl');

const router = express.Router();

// Root uploads folder - every served file must stay inside this directory
const UPLOADS_ROOT = path.resolve(__dirname, '..', 'uploads');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

// @desc    Serve a protected upload via a short-lived signed URL
// @route   GET /api/files/:category/:name?e=<expiry>&s=<signature>
// @access  Signature-gated (URLs are minted only by authorised API responses)
router.get('/:category/:name', (req, res) => {
  const { category, name } = req.params;
  const { e: exp, s: sig } = req.query;

  const check = verifyFileSignature(category, name, exp, sig);
  if (!check.ok) {
    const status = check.reason === 'expired' ? 410 : 403;
    return res.status(status).json({
      success: false,
      message: check.reason === 'expired'
        ? 'This file link has expired. Please reload and try again.'
        : 'Not authorized to access this file',
    });
  }

  // Build the path and make sure it didn't escape the uploads folder
  const decodedName = path.basename(decodeURIComponent(name));
  const absolutePath = path.resolve(UPLOADS_ROOT, category, decodedName);
  if (!absolutePath.startsWith(UPLOADS_ROOT + path.sep)) {
    return res.status(403).json({ success: false, message: 'Invalid file path' });
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }

  const ext = path.extname(absolutePath).toLowerCase();
  res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  // Don't let medical files be cached by shared/proxy caches
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.sendFile(absolutePath);
});

module.exports = router;
