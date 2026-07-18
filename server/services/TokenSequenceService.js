const TokenSequence = require('../models/TokenSequence');

// TokenSequenceService gives out queue token numbers.
// It uses findOneAndUpdate with $inc + upsert, which is atomic, so no retry loop is needed.
//
// A and W tokens share one counter; E (emergency) tokens have their own.
// Tokens look like A001, W002, E001 (prefix + 3-digit number).

// Build the filter that identifies one TokenSequence document.
// Null fields are kept so the unique index works correctly.
const _buildFilter = (scope, sequenceType) => ({
  departmentId: scope.departmentId || null,
  doctorId:     scope.doctorId     || null,
  date:         scope.date,
  timeBlockId:  scope.timeBlockId  || null,
  sequenceType
});

// Bump the shared A/W counter and return the next number
const nextNormal = async (scope) => {
  const filter = _buildFilter(scope, 'NORMAL');
  const doc = await TokenSequence.findOneAndUpdate(
    filter,
    { $inc: { lastNumber: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc.lastNumber;
};

// Bump the emergency counter and return the next number
const nextEmergency = async (scope) => {
  const filter = _buildFilter(
    { departmentId: scope.departmentId, doctorId: null, date: scope.date, timeBlockId: null },
    'EMERGENCY'
  );
  const doc = await TokenSequence.findOneAndUpdate(
    filter,
    { $inc: { lastNumber: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc.lastNumber;
};

// Turn a prefix + number into a token string, e.g. 'A014'
const formatToken = (prefix, number) =>
  `${prefix}${String(number).padStart(3, '0')}`;

// Give out the next A (appointment) token
const nextAppointmentToken = async (scope) => {
  const sequenceNumber = await nextNormal(scope);
  return { queueNumber: formatToken('A', sequenceNumber), sequenceNumber };
};

// Give out the next W (walk-in) token
const nextWalkInToken = async (scope) => {
  const sequenceNumber = await nextNormal(scope);
  return { queueNumber: formatToken('W', sequenceNumber), sequenceNumber };
};

// Give out the next E (emergency) token
const nextEmergencyToken = async (scope) => {
  const sequenceNumber = await nextEmergency(scope);
  return { queueNumber: formatToken('E', sequenceNumber), sequenceNumber };
};

// Read the current last number without changing it (0 if none yet)
const currentNumber = async (scope, sequenceType = 'NORMAL') => {
  const filter = _buildFilter(scope, sequenceType);
  const doc = await TokenSequence.findOne(filter).lean();
  return doc?.lastNumber ?? 0;
};

// Build the scope object that decides how tokens are grouped.
// tokenScope (from QueuePolicy) can be:
//   'dept_date_session' - department + date + block (default)
//   'dept_date'         - department + date
//   'doctor_date'       - doctor + date (specialist)
const buildScope = ({ departmentId, doctorId, date, timeBlockId, tokenScope = 'dept_date_session' }) => {
  if (tokenScope === 'doctor_date') {
    return { departmentId: null, doctorId, date, timeBlockId: null };
  }
  if (tokenScope === 'dept_date') {
    return { departmentId, doctorId: null, date, timeBlockId: null };
  }
  // Default: dept_date_session
  return { departmentId, doctorId: null, date, timeBlockId: timeBlockId || null };
};

module.exports = {
  nextNormal,
  nextEmergency,
  nextAppointmentToken,
  nextWalkInToken,
  nextEmergencyToken,
  currentNumber,
  buildScope,
  formatToken
};
