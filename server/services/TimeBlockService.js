const TimeBlock = require('../models/TimeBlock');
const Appointment = require('../models/Appointment');
const QueuePolicy = require('../models/QueuePolicy');

// TimeBlockService handles time blocks - the booking unit for General OPD.
// Patients pick a block (e.g. 9:00-10:00) instead of an exact time.

// Split a block's total capacity into appointment/walk-in/emergency/buffer
// using the percentages from the queue policy.
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

// Create time blocks for a department across a date range, from a set of templates
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
          reportingOffsetMinutes: tpl.reportingOffsetMinutes ?? 30,
          status: 'active',
          createdBy
        });
        created.push(block);
      } catch (err) {
        if (err.code === 11000) {
          // Block already exists for this dept/doctor/date/time - skip it
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

// True once a block's end time has passed (only matters for today's blocks)
const isSessionClosed = (blockDate, endTime, now = new Date()) => {
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (blockDate !== todayStr) return false; // only today's blocks can be "closed"

  const [eh, em] = endTime.split(':').map(Number);
  const sessionEndMinutes = eh * 60 + em;
  const currentMinutes    = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= sessionEndMinutes;
};

// True if booking should be rejected. Booking closes a few minutes
// (minimumArrivalBufferMinutes) before the session ends so the patient
// still has time to arrive. e.g. slot ending 18:00 with a 30 min buffer closes at 17:30.
const isBookingCutoffReached = (blockDate, endTime, minimumArrivalBufferMinutes = 30, now = new Date()) => {
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (blockDate !== todayStr) return false; // future-date blocks are always bookable

  const [eh, em] = endTime.split(':').map(Number);
  const sessionEndMinutes  = eh * 60 + em;
  const cutoffMinutes      = sessionEndMinutes - minimumArrivalBufferMinutes;
  const currentMinutes     = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= cutoffMinutes;
};

// Get the blocks a patient can book for a department/date.
// Each block is tagged with an availability status and remaining slot count.
const getAvailableBlocks = async (departmentId, date, doctorId = null, patientId = null) => {
  const query = {
    departmentId,
    date,
    status: 'active'
  };
  if (doctorId) query.doctorId = doctorId;
  else query.doctorId = null;

  const blocks = await TimeBlock.find(query).sort({ startTime: 1 }).lean({ virtuals: true });

  const now = new Date(); // single reference time for the entire batch
  let sameDeptConflict = false;

  if (patientId) {
    sameDeptConflict = await Appointment.hasActiveSameDeptDayConflict(patientId, departmentId, date);
  }

  // Tag each block with an availability status
  const annotated = [];
  for (const b of blocks) {
    // Today's sessions close once the booking cutoff has passed
    if (isBookingCutoffReached(b.date, b.endTime, 30, now)) {
      annotated.push({
        ...b,
        remainingSlots:     0,
        availabilityStatus: 'CLOSED',
        closedReason:       'Booking window has passed for this session'
      });
      continue;
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

    const conflictMessage = patientId
      ? (
          sameDeptConflict
            ? 'You already have another appointment during this time. Please choose a non-conflicting time slot.'
            : await Appointment.hasActiveTimeBlockOverlap(patientId, departmentId, date, b.startTime, b.endTime)
              ? 'You already have another appointment during this time. Please choose a non-conflicting time slot.'
              : null
        )
      : null;

    annotated.push({
      ...b,
      remainingSlots: Math.max(0, remaining),
      availabilityStatus,
      patientConflict: Boolean(conflictMessage),
      conflictMessage
    });
  }

  return annotated;
};

// Create a single time block, working out the capacity splits
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

// Update a block's capacity or status.
// Won't let capacity drop below the number already booked.
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

module.exports = { generateBlocksForRange, getAvailableBlocks, createBlock, updateBlock, splitCapacity, isSessionClosed, isBookingCutoffReached };

