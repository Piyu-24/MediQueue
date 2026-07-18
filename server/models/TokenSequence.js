const mongoose = require('mongoose');

// Counter for token numbers.
// NORMAL is shared by A and W tokens (so A001, W002, A003 all come from one counter).
// EMERGENCY is a separate counter for E tokens.
// The scope keys (department/doctor/date/block) depend on QueuePolicy.tokenScope.
const tokenSequenceSchema = new mongoose.Schema({
  // Scope keys - only the ones relevant to the chosen scope are set
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

  // Which counter this is
  sequenceType: {
    type: String,
    enum: ['NORMAL', 'EMERGENCY'],
    required: true
  },

  // The last number handed out
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
