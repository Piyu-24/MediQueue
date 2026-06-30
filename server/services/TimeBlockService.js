const TimeBlock = require('../models/TimeBlock');
const QueuePolicy = require('../models/QueuePolicy');

/**
 * TimeBlockService — CRUD and capacity helpers for time blocks.
 *
 * Blocks are the booking unit for General OPD: patients select a block
 * (e.g. 9:00–10:00) rather than an exact minute.
 *
 * Capacity allocation follows the hospital's configured percentages:
 *   appointmentCapacity = floor(total × appointmentPct / 100)
 *   walkInCapacity      = floor(total × walkInPct / 100)
 *   emergencyBuffer     = floor(total × emergencyPct / 100)
 *   operationalBuffer   = remainder
 */

/**
 * Derive capacity splits from a total capacity and policy percentages.
 *
 * @param {number} totalCapacity
 * @param {object} policy  QueuePolicy document (or plain object with capacity fields)
 * @returns {{ appointmentCapacity, walkInCapacity, emergencyBuffer, operationalBuffer }}
 */
const splitCapacity = (totalCapacity, policy) => {
  const apptPct    = policy.appointmentCapacityPercentage  ?? 65;
  const walkInPct  = policy.walkInCapacityPercentage       ?? 25;
  const emergPct   = policy.emergencyBufferPercentage      ?? 5;

  const appointmentCapacity = Math.floor(totalCapacity * apptPct    / 100);
  const walkInCapacity      = Math.floor(totalCapacity * walkInPct  / 100);
  const emergencyBuffer     = Math.floor(totalCapacity * emergPct   / 100);
  const operationalBuffer   = Math.max(
    0,
    totalCapacity - appointmentCapacity - walkInCapacity - emergencyBuffer
  );

  return { appointmentCapacity, walkInCapacity, emergencyBuffer, operationalBuffer };
};

/**
 * Generate time blocks for a department for a range of dates using a template.
 *
 * @param {object} opts
 * @param {string}   opts.departmentId
 * @param {string}   opts.startDate         YYYY-MM-DD
 * @param {string}   opts.endDate           YYYY-MM-DD
 * @param {object[]} opts.blockTemplates    Array of { startTime, endTime, sessionName, totalCapacity }
 * @param {string|null} opts.doctorId       null for General OPD blocks
 * @param {string}   opts.createdBy         User ObjectId
 * @param {object}   opts.policy            QueuePolicy (for capacity percentages)
 * @returns {Promise<{ created: number, skipped: number, blocks: TimeBlock[] }>}
 */
const generateBlocksForRange = async ({
  departmentId,
  startDate,
  endDate,
  blockTemplates,
  doctorId = null,
  createdBy,
  policy
}) => {
  const start = new Date(startDate);
  const end   = new Date(endDate);

  if (isNaN(start) || isNaN(end) || start > end) {
    throw Object.assign(new Error('Invalid date range'), { statusCode: 400 });
  }
  if (!blockTemplates || blockTemplates.length === 0) {
    throw Object.assign(new Error('At least one block template is required'), { statusCode: 400 });
  }

  const resolvedPolicy = policy || await QueuePolicy.resolveFor(null, departmentId);
  const created = [];
  let skipped = 0;

  const current = new Date(start);
  while (current <= end) {
    const date = current.toISOString().slice(0, 10);

    for (const tpl of blockTemplates) {
      const { appointmentCapacity, walkInCapacity, emergencyBuffer, operationalBuffer } =
        splitCapacity(tpl.totalCapacity, resolvedPolicy);

      try {
        const block = await TimeBlock.create({
          departmentId,
          doctorId,
          date,
          startTime:            tpl.startTime,
          endTime:              tpl.endTime,
          sessionName:          tpl.sessionName,
          totalCapacity:        tpl.totalCapacity,
          appointmentCapacity,
          walkInCapacity,
          emergencyBuffer,
          operationalBuffer,
          reportingOffsetMinutes: tpl.reportingOffsetMinutes ?? 15,
          status: 'active',
          createdBy
        });
        created.push(block);
      } catch (err) {
        if (err.code === 11000) {
          // Block already exists for this dept+doctor+date+startTime — skip
          skipped++;
        } else {
          throw err;
        }
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return { created: created.length, skipped, blocks: created };
};

/**
 * Return true if a time block's booking window has already closed.
 *
 * A block is closed only after its end time has passed — patients can still
 * book into a session that has started but not yet ended.
 *
 * @param {string} blockDate   YYYY-MM-DD  (the block's own date field)
 * @param {string} endTime     HH:MM       (the block's end time)
 * @param {Date}   [now]       Override for unit testing; defaults to new Date()
 * @returns {boolean}
 */
const isSessionClosed = (blockDate, endTime, now = new Date()) => {
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (blockDate !== todayStr) return false; // only today's blocks can be "closed"

  const [eh, em] = endTime.split(':').map(Number);
  const sessionEndMinutes = eh * 60 + em;
  const currentMinutes    = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= sessionEndMinutes;
};

/**
 * Get available blocks for appointment booking.
 * Only returns blocks where bookedAppointmentCount < appointmentCapacity.
 * For today's date, blocks whose start time has already passed are marked CLOSED.
 *
 * @param {string} departmentId
 * @param {string} date           YYYY-MM-DD
 * @param {string|null} doctorId  null = General OPD, set = specialist
 * @returns {Promise<object[]>}   lean blocks with virtuals, each annotated with
 *                                 availabilityStatus and remainingSlots
 */
const getAvailableBlocks = async (departmentId, date, doctorId = null) => {
  const query = {
    departmentId,
    date,
    status: 'active'
  };
  if (doctorId) query.doctorId = doctorId;
  else query.doctorId = null;

  const blocks = await TimeBlock.find(query).sort({ startTime: 1 }).lean({ virtuals: true });

  const now = new Date(); // single reference time for the entire batch

  // Annotate each block with availability status (mirrors frontend colour coding)
  return blocks.map(b => {
    // Today's sessions: closed once the session end time has passed
    if (isSessionClosed(b.date, b.endTime, now)) {
      return {
        ...b,
        remainingSlots:     0,
        availabilityStatus: 'CLOSED',
        closedReason:       'Booking window has passed for this session'
      };
    }

    const remaining = b.appointmentCapacity - b.bookedAppointmentCount;
    let availabilityStatus;
    if (remaining <= 0) {
      availabilityStatus = 'FULLY_BOOKED';
    } else if (remaining <= Math.ceil(b.appointmentCapacity * 0.2)) {
      availabilityStatus = 'LIMITED';
    } else {
      availabilityStatus = 'AVAILABLE';
    }
    return { ...b, remainingSlots: Math.max(0, remaining), availabilityStatus };
  });
};

/**
 * Create a single time block with computed capacity splits.
 *
 * @param {object} data  Matches TimeBlock schema fields + optional policy
 * @returns {Promise<TimeBlock>}
 */
const createBlock = async (data) => {
  const policy = data.policy || await QueuePolicy.resolveFor(null, data.departmentId);
  const { appointmentCapacity, walkInCapacity, emergencyBuffer, operationalBuffer } =
    splitCapacity(data.totalCapacity, policy);

  return TimeBlock.create({
    ...data,
    appointmentCapacity:  data.appointmentCapacity  ?? appointmentCapacity,
    walkInCapacity:       data.walkInCapacity        ?? walkInCapacity,
    emergencyBuffer:      data.emergencyBuffer       ?? emergencyBuffer,
    operationalBuffer:    data.operationalBuffer     ?? operationalBuffer
  });
};

/**
 * Update a block's capacity or status (admin only).
 * Does not allow reducing capacity below current booked count.
 */
const updateBlock = async (blockId, updates) => {
  const block = await TimeBlock.findById(blockId);
  if (!block) throw Object.assign(new Error('Time block not found'), { statusCode: 404 });

  if (updates.appointmentCapacity !== undefined &&
      updates.appointmentCapacity < block.bookedAppointmentCount) {
    throw Object.assign(
      new Error(`Cannot reduce appointment capacity below current bookings (${block.bookedAppointmentCount})`),
      { statusCode: 400 }
    );
  }

  Object.assign(block, updates);
  return block.save();
};

module.exports = { generateBlocksForRange, getAvailableBlocks, createBlock, updateBlock, splitCapacity, isSessionClosed };
