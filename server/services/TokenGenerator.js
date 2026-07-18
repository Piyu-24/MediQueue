const QueueEntry = require('../models/QueueEntry');

// Makes queue token numbers per doctor per day.
// Tokens look like A001 (appointment), W001 (walk-in), E001 (emergency)
// and never change once issued.

// Get the next token for a doctor on a date
const generateToken = async (doctorId, queueDate, tokenType = 'A') => {
  return QueueEntry.generateToken(doctorId, queueDate, tokenType);
};

// Work out the token type (A/W/E) from the check-in details
const resolveTokenType = ({ isEmergency = false, isWalkIn = false }) => {
  if (isEmergency) return 'E';
  if (isWalkIn) return 'W';
  return 'A';
};

// Build a YYYY-MM-DD string using local time, not UTC
const localDateStr = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

module.exports = { generateToken, resolveTokenType, localDateStr };
