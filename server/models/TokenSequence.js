const mongoose = require('mongoose');

/**
 * TokenSequence — atomic counter for A/W/E token numbering.
 *
 * There are two sequence types:
 *   NORMAL    — shared by A (appointment) and W (walk-in) tokens.
 *               Scoped per (departmentId, date) or (doctorId, date) based on policy.
 *               Example: A001, W002, A003, W004 all come from the same counter.
 *   EMERGENCY — separate counter for E tokens, always starts at 1 each day.
 *               Scoped per departmentId + date (or globally per date).
 *
 * Token uniqueness rule:
 *   A and W tokens share a numeric sequence so that the combined display
 *   shows a meaningful ordering (A001 was patient #1, W002 was patient #2).
 *   E tokens are independent and never consume the A/W quota.
 *
 * Token scope (driven by QueuePolicy.tokenScope):
 *   dept_date_session — per department + date + timeBlock  (default)
 *   dept_date         — per department + date (shared across all blocks)
 *   doctor_date       — per doctor + date (specialist booking)
 *
 * The TokenSequenceService uses findOneAndUpdate with $inc and upsert:true
 * for atomic counter increments — no race conditions, no retries needed.
 */
const tokenSequenceSchema = new mongoose.Schema({
  // ── Scope keys (only the fields relevant to the chosen tokenScope are set) ───
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  // YYYY-MM-DD — daily reset
  date: {
    type: String,
    required: [true, 'Date is required'],
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'],
    index: true
  },
  // null = shared across all blocks for this dept+date; set = block-specific
  timeBlockId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeBlock',
    default: null
  },

  // ── Counter type ──────────────────────────────────────────────────────────────
  sequenceType: {
    type: String,
    enum: ['NORMAL', 'EMERGENCY'],
    required: true
  },

  // ── Counter ───────────────────────────────────────────────────────────────────
  lastNumber: {
    type: Number,
    default: 0,
    min: [0, 'lastNumber cannot be negative']
  }
}, {
  timestamps: true
});

// Unique index: exactly one counter per (dept, doctor, date, block, type)
tokenSequenceSchema.index(
  { departmentId: 1, doctorId: 1, date: 1, timeBlockId: 1, sequenceType: 1 },
  { unique: true, name: 'unique_token_sequence' }
);

module.exports = mongoose.model('TokenSequence', tokenSequenceSchema);
