const TokenSequence = require('../models/TokenSequence');

/**
 * TokenSequenceService — atomic token counter management.
 *
 * All public methods use MongoDB findOneAndUpdate with $inc + upsert:true,
 * which is atomic at the document level. No retry loops needed for token
 * assignment (unlike the old QueueEntry.generateToken approach).
 *
 * Token rules (from spec):
 *   A and W share the same NORMAL sequence per scope.
 *   E tokens use a separate EMERGENCY sequence per scope.
 *   Token format: <PREFIX><zero-padded-3-digit-number>
 *     A001, W002, A003 ... (shared counter)
 *     E001, E002 ...       (separate counter)
 */

/**
 * Build the scope filter for a TokenSequence document.
 * Null fields are explicitly included so the unique index fires correctly.
 *
 * @param {object} scope
 * @param {string|null} scope.departmentId  ObjectId string or null
 * @param {string|null} scope.doctorId      ObjectId string or null
 * @param {string}      scope.date          YYYY-MM-DD
 * @param {string|null} scope.timeBlockId   ObjectId string or null
 * @param {'NORMAL'|'EMERGENCY'} sequenceType
 */
const _buildFilter = (scope, sequenceType) => ({
  departmentId: scope.departmentId || null,
  doctorId:     scope.doctorId     || null,
  date:         scope.date,
  timeBlockId:  scope.timeBlockId  || null,
  sequenceType
});

/**
 * Atomically increment the NORMAL (A/W shared) counter and return the next number.
 *
 * @param {object} scope
 * @param {string|null} scope.departmentId
 * @param {string|null} scope.doctorId
 * @param {string}      scope.date          YYYY-MM-DD
 * @param {string|null} scope.timeBlockId
 * @returns {Promise<number>} next sequence number (starts at 1)
 */
const nextNormal = async (scope) => {
  const filter = _buildFilter(scope, 'NORMAL');
  const doc = await TokenSequence.findOneAndUpdate(
    filter,
    { $inc: { lastNumber: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc.lastNumber;
};

/**
 * Atomically increment the EMERGENCY counter and return the next number.
 *
 * @param {object} scope — only departmentId + date used for emergency scope
 * @returns {Promise<number>} next emergency sequence number (starts at 1)
 */
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

/**
 * Format a number into a token string.
 * @param {'A'|'W'|'E'} prefix
 * @param {number} number
 * @returns {string} e.g. 'A014', 'W002', 'E001'
 */
const formatToken = (prefix, number) =>
  `${prefix}${String(number).padStart(3, '0')}`;

/**
 * Issue the next A (appointment) token for a scope.
 * @param {object} scope  { departmentId, doctorId, date, timeBlockId }
 * @returns {Promise<{ queueNumber: string, sequenceNumber: number }>}
 */
const nextAppointmentToken = async (scope) => {
  const sequenceNumber = await nextNormal(scope);
  return { queueNumber: formatToken('A', sequenceNumber), sequenceNumber };
};

/**
 * Issue the next W (walk-in) token for a scope.
 * @param {object} scope  { departmentId, doctorId, date, timeBlockId }
 * @returns {Promise<{ queueNumber: string, sequenceNumber: number }>}
 */
const nextWalkInToken = async (scope) => {
  const sequenceNumber = await nextNormal(scope);
  return { queueNumber: formatToken('W', sequenceNumber), sequenceNumber };
};

/**
 * Issue the next E (emergency) token for a scope.
 * @param {object} scope  { departmentId, date }
 * @returns {Promise<{ queueNumber: string, sequenceNumber: number }>}
 */
const nextEmergencyToken = async (scope) => {
  const sequenceNumber = await nextEmergency(scope);
  return { queueNumber: formatToken('E', sequenceNumber), sequenceNumber };
};

/**
 * Peek at the current last number for a scope/type without incrementing.
 * Useful for display and audit purposes.
 *
 * @param {object} scope
 * @param {'NORMAL'|'EMERGENCY'} sequenceType
 * @returns {Promise<number>} current lastNumber (0 if no sequence yet)
 */
const currentNumber = async (scope, sequenceType = 'NORMAL') => {
  const filter = _buildFilter(scope, sequenceType);
  const doc = await TokenSequence.findOne(filter).lean();
  return doc?.lastNumber ?? 0;
};

/**
 * Build a scope object from available context.
 * Picks the most specific scope available.
 *
 * tokenScope choices (from QueuePolicy):
 *   'dept_date_session' — departmentId + date + timeBlockId  (default)
 *   'dept_date'         — departmentId + date (cross-block)
 *   'doctor_date'       — doctorId + date (specialist)
 *
 * @param {object} ctx
 * @param {string|null} ctx.departmentId
 * @param {string|null} ctx.doctorId
 * @param {string}      ctx.date
 * @param {string|null} ctx.timeBlockId
 * @param {string}      ctx.tokenScope  'dept_date_session'|'dept_date'|'doctor_date'
 */
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
