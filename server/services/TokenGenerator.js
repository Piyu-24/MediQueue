const QueueEntry = require('../models/QueueEntry');

/**
 * TokenGenerator — deterministic per-doctor per-day token number generation.
 *
 * Token format: <TYPE><DDD>
 *   A001  appointment patient (tokenType = 'A')
 *   W001  walk-in patient     (tokenType = 'W')
 *   E001  emergency patient   (tokenType = 'E')
 *
 * Scoped per doctor + tokenType + queueDate.
 * Token numbers are fixed after issue and never change.
 */

/**
 * Get the next token for a doctor on a given date.
 * Uses QueueEntry.generateToken() which counts existing tokens to determine next number.
 *
 * @param {string} doctorId  MongoDB ObjectId string
 * @param {string} queueDate YYYY-MM-DD local date string
 * @param {'A'|'W'|'E'} tokenType
 * @returns {Promise<{ queueNumber: string, sequenceNumber: number }>}
 */
const generateToken = async (doctorId, queueDate, tokenType = 'A') => {
  return QueueEntry.generateToken(doctorId, queueDate, tokenType);
};

/**
 * Determine the tokenType from check-in context.
 * @param {{ isEmergency: boolean, isWalkIn: boolean }} opts
 * @returns {'A'|'W'|'E'}
 */
const resolveTokenType = ({ isEmergency = false, isWalkIn = false }) => {
  if (isEmergency) return 'E';
  if (isWalkIn) return 'W';
  return 'A';
};

/**
 * Build the local date string (YYYY-MM-DD) without UTC offset issues.
 * Uses the server's local timezone, not UTC.
 */
const localDateStr = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

module.exports = { generateToken, resolveTokenType, localDateStr };
