// Server origin (API URL without the trailing /api), used to resolve local
// signed file paths (/api/files/...).
export const SERVER_BASE = process.env.REACT_APP_API_URL
  ? process.env.REACT_APP_API_URL.replace('/api', '')
  : 'http://localhost:5000';

/**
 * Resolve a stored document `fileUrl` to a directly loadable URL.
 *
 * The server now returns signed URLs whose shape depends on where the file
 * lives:
 *   - Cloudinary  → an absolute https:// URL (use as-is)
 *   - Local disk  → a relative /api/files/... path (needs the server origin)
 *
 * Prepending SERVER_BASE to an already-absolute URL produces a broken value
 * like `http://localhost:5000https://...` (which the browser blocks), so
 * absolute URLs must be passed through untouched.
 */
export function resolveFileUrl(fileUrl) {
  if (!fileUrl) return fileUrl;
  return /^https?:\/\//i.test(fileUrl) ? fileUrl : `${SERVER_BASE}${fileUrl}`;
}
