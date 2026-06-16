const DoctorSlot = require('../models/DoctorSlot');
const Appointment = require('../models/Appointment');
const User = require('../models/User');

// Default working hours when the doctor has no schedule configured
const DEFAULT_START = '09:00';
const DEFAULT_END   = '17:00';
const DEFAULT_SLOT_DURATION = 15; // minutes

// Day names matching User.availability keys (Sunday = 0)
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Appointment statuses that consume a slot
const ACTIVE_BOOKING_STATUSES = [
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const toMinutes = (hhmm) => {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
};

const formatTime = (totalMinutes) => {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Determine the doctor's working schedule for a specific date.
 * Checks User.availability, then User.workingDays/workingHours, then hard defaults.
 *
 * @returns {{ available: boolean, startTime?: string, endTime?: string, reason?: string }}
 */
const getDoctorScheduleForDate = (doctor, dateStr) => {
  if (!doctor.isActive) {
    return { available: false, reason: 'Doctor is inactive' };
  }

  const date = new Date(dateStr);
  const dayName = DAY_NAMES[date.getDay()];

  // Use the structured availability object if present and configured (at least one day enabled)
  let usesStructuredAvailability = false;
  if (doctor.availability) {
    // Exclude Mongoose internal properties like $init if iterating, but we know the schema keys
    usesStructuredAvailability = DAY_NAMES.some(day => doctor.availability[day]?.enabled);
  }

  if (usesStructuredAvailability) {
    const avail = doctor.availability[dayName];
    if (!avail.enabled) {
      return { available: false, reason: `Doctor does not work on ${dayName}s` };
    }
    return {
      available: true,
      startTime: avail.startTime || DEFAULT_START,
      endTime: avail.endTime || DEFAULT_END
    };
  }

  // Fall back to workingDays array + workingHours
  if (doctor.workingDays?.length > 0) {
    const dayCapitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    if (!doctor.workingDays.includes(dayCapitalized) && !doctor.workingDays.includes(dayName)) {
      return { available: false, reason: 'Doctor does not work on this day' };
    }
    return {
      available: true,
      startTime: doctor.workingHours?.start || DEFAULT_START,
      endTime: doctor.workingHours?.end || DEFAULT_END
    };
  }

  // Final fallback: weekdays 09:00–17:00
  const dow = date.getDay();
  if (dow === 0 || dow === 6) {
    return { available: false, reason: 'Doctor is not available on weekends' };
  }
  return { available: true, startTime: DEFAULT_START, endTime: DEFAULT_END };
};

/**
 * Generate equal-duration time slots between startTime and endTime.
 */
const generateSlots = (startTime, endTime, duration = DEFAULT_SLOT_DURATION) => {
  const slots = [];
  let cur = toMinutes(startTime);
  const end = toMinutes(endTime);
  while (cur + duration <= end) {
    slots.push({ startTime: formatTime(cur), endTime: formatTime(cur + duration), duration });
    cur += duration;
  }
  return slots;
};

/**
 * Calculate the availability status for a single slot.
 *
 * @param {object} slot            { startTime, endTime, duration }
 * @param {object} ctx
 *   doctorSlots         — DoctorSlot[] for the date
 *   activeAppointments  — Appointment[] (active) for doctor+date
 *   patientAppointments — Appointment[] (active) for patient+date, or null
 *   dateStr             — YYYY-MM-DD
 *   defaultCapacity     — per-slot capacity when no DoctorSlot defines it
 *
 * @returns {{ status, capacity, bookedCount, remainingCapacity, isSelectable, reason }}
 */
const calcSlotStatus = (slot, { dateStr, doctorSlots, activeAppointments, patientAppointments, defaultCapacity = 1 }) => {
  const now = new Date();
  const [sH, sM] = slot.startTime.split(':').map(Number);
  const slotDT = new Date(dateStr);
  slotDT.setHours(sH, sM, 0, 0);

  // Past
  if (slotDT <= now) {
    return { status: 'PAST_SLOT', capacity: defaultCapacity, bookedCount: 0, remainingCapacity: 0, isSelectable: false, reason: 'Past' };
  }

  const slotStart = toMinutes(slot.startTime);
  const slotEnd   = toMinutes(slot.endTime);
  let capacity = defaultCapacity;

  // Check if an explicit DoctorSlot covers (overlaps) this time window
  const matchingDS = doctorSlots.find(ds => {
    const dsStart = toMinutes(ds.startTime);
    const dsEnd   = toMinutes(ds.endTime);
    return slotStart < dsEnd && slotEnd > dsStart;
  });

  if (matchingDS) {
    if (matchingDS.status === 'BLOCKED' || matchingDS.status === 'CANCELLED') {
      const raw = matchingDS.blockingInfo?.reason || 'unavailable';
      return {
        status: 'DOCTOR_UNAVAILABLE',
        capacity,
        bookedCount: 0,
        remainingCapacity: 0,
        isSelectable: false,
        reason: `Doctor unavailable: ${raw.toLowerCase().replace(/_/g, ' ')}`
      };
    }
    capacity = matchingDS.maxPatients || defaultCapacity;
  }

  // Count active appointments overlapping this slot (block-based OPD appts skipped)
  const bookedCount = activeAppointments.filter(appt => {
    if (!appt.appointmentTime) return false;
    const [aH, aM] = appt.appointmentTime.split(':').map(Number);
    const aStart = aH * 60 + aM;
    const aEnd   = aStart + (appt.duration || DEFAULT_SLOT_DURATION);
    return slotStart < aEnd && slotEnd > aStart;
  }).length;

  const remainingCapacity = Math.max(0, capacity - bookedCount);

  if (remainingCapacity === 0) {
    return { status: 'FULLY_BOOKED', capacity, bookedCount, remainingCapacity: 0, isSelectable: false, reason: 'This slot is fully booked' };
  }

  // Patient conflict check
  if (patientAppointments) {
    const conflict = patientAppointments.some(appt => {
      if (!appt.appointmentTime) return false;
      const [aH, aM] = appt.appointmentTime.split(':').map(Number);
      const aStart = aH * 60 + aM;
      const aEnd   = aStart + (appt.duration || DEFAULT_SLOT_DURATION);
      return slotStart < aEnd && slotEnd > aStart;
    });
    if (conflict) {
      return {
        status: 'PATIENT_CONFLICT',
        capacity,
        bookedCount,
        remainingCapacity,
        isSelectable: false,
        reason: 'You already have an appointment at this time'
      };
    }
  }

  if (remainingCapacity <= 2) {
    return {
      status: 'LIMITED_AVAILABILITY',
      capacity,
      bookedCount,
      remainingCapacity,
      isSelectable: true,
      reason: `${remainingCapacity} slot${remainingCapacity === 1 ? '' : 's'} left`
    };
  }

  return { status: 'AVAILABLE', capacity, bookedCount, remainingCapacity, isSelectable: true, reason: null };
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the full slot availability grid for a doctor on a given date.
 *
 * @param {string} doctorId
 * @param {string} dateStr    YYYY-MM-DD
 * @param {string|null} patientId  — include to surface PATIENT_CONFLICT statuses
 * @returns {Promise<object>}
 */
const getSlotAvailability = async (doctorId, dateStr, patientId = null) => {
  const doctor = await User.findOne({ _id: doctorId, role: 'doctor' })
    .select('firstName lastName specialization department isActive availability workingDays workingHours')
    .lean();

  if (!doctor) {
    const err = new Error('Doctor not found');
    err.statusCode = 404;
    throw err;
  }
  if (!doctor.isActive) {
    const err = new Error('Doctor is inactive');
    err.statusCode = 400;
    throw err;
  }

  const scheduleForDate = getDoctorScheduleForDate(doctor, dateStr);

  const startOfDay = new Date(dateStr); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(dateStr); endOfDay.setHours(23, 59, 59, 999);

  // Load all DoctorSlots for this doctor/date
  const doctorSlots = await DoctorSlot.find({
    doctor: doctorId,
    date: { $gte: startOfDay, $lte: endOfDay }
  }).lean();

  // Check for a full-day block
  const fullDayBlock = doctorSlots.find(ds =>
    ds.status === 'BLOCKED' &&
    (toMinutes(ds.startTime) === 0 || ds.startTime === '00:00') &&
    (toMinutes(ds.endTime) >= 23 * 60 + 59 || ds.endTime === '23:59')
  );

  if (fullDayBlock || (!scheduleForDate.available && doctorSlots.length === 0)) {
    const reason = fullDayBlock
      ? `Doctor unavailable: ${(fullDayBlock.blockingInfo?.reason || 'unavailable').toLowerCase().replace(/_/g, ' ')}`
      : scheduleForDate.reason;
    return {
      doctor: { _id: doctorId, firstName: doctor.firstName, lastName: doctor.lastName, specialization: doctor.specialization, department: doctor.department },
      date: dateStr,
      available: false,
      reason,
      totalSlots: 0,
      availableSlotCount: 0,
      nextAvailableSlot: null,
      slots: []
    };
  }

  // Active appointments for this doctor/date
  const activeAppointments = await Appointment.find({
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ACTIVE_BOOKING_STATUSES }
  }).select('appointmentTime duration').lean();

  // Patient's appointments on this date (for conflict detection)
  let patientAppointments = null;
  if (patientId) {
    patientAppointments = await Appointment.find({
      patient: patientId,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ACTIVE_BOOKING_STATUSES }
    }).select('appointmentTime duration').lean();
  }

  // Determine working hours
  const { startTime, endTime } = scheduleForDate.available
    ? scheduleForDate
    : { startTime: DEFAULT_START, endTime: DEFAULT_END };

  // Use explicit DoctorSlots as the slot template if available (non-blocked ones)
  const explicitSlots = doctorSlots.filter(ds => ds.status !== 'BLOCKED' && ds.status !== 'CANCELLED');
  let templateSlots;
  if (explicitSlots.length > 0) {
    templateSlots = explicitSlots
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
      .map(ds => ({ startTime: ds.startTime, endTime: ds.endTime, duration: ds.duration || DEFAULT_SLOT_DURATION }));
  } else {
    templateSlots = generateSlots(startTime, endTime, DEFAULT_SLOT_DURATION);
  }

  // Enrich each slot with availability status
  const enrichedSlots = templateSlots.map(slot => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
    duration: slot.duration || DEFAULT_SLOT_DURATION,
    ...calcSlotStatus(slot, { dateStr, doctorSlots, activeAppointments, patientAppointments, defaultCapacity: 1 })
  }));

  const availableCount = enrichedSlots.filter(s => s.isSelectable).length;
  const nextAvailable  = enrichedSlots.find(s => s.isSelectable);

  return {
    doctor: { _id: doctorId, firstName: doctor.firstName, lastName: doctor.lastName, specialization: doctor.specialization, department: doctor.department },
    date: dateStr,
    available: availableCount > 0,
    reason: availableCount === 0 && scheduleForDate.available ? 'No available slots for this date' : scheduleForDate.reason || null,
    totalSlots: enrichedSlots.length,
    availableSlotCount: availableCount,
    nextAvailableSlot: nextAvailable?.startTime || null,
    slots: enrichedSlots
  };
};

/**
 * Get available doctors for a department/specialization on a given date.
 *
 * @param {string|null} departmentId   — department or specialization string
 * @param {string} dateStr             — YYYY-MM-DD
 * @param {string|null} patientId
 * @returns {Promise<Array>}
 */
const getAvailableDoctors = async (departmentId, dateStr, patientId = null) => {
  const query = { role: 'doctor', isActive: true };
  if (departmentId) {
    query.$or = [
      { department: { $regex: new RegExp(`^${departmentId}$`, 'i') } },
      { specialization: { $regex: new RegExp(`^${departmentId}$`, 'i') } }
    ];
  }

  const doctors = await User.find(query)
    .select('firstName lastName specialization department isActive availability workingDays workingHours consultationFee yearsOfExperience bio')
    .lean();

  const startOfDay = new Date(dateStr); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(dateStr); endOfDay.setHours(23, 59, 59, 999);

  return Promise.all(doctors.map(async (doctor) => {
    try {
      const schedule = getDoctorScheduleForDate(doctor, dateStr);

      // Quick full-day block check (cheap — no slot generation)
      const fullDayBlock = await DoctorSlot.findOne({
        doctor: doctor._id,
        date: { $gte: startOfDay, $lte: endOfDay },
        status: 'BLOCKED',
        startTime: '00:00'
      }).lean();

      if (!schedule.available || fullDayBlock) {
        return {
          doctorId: doctor._id,
          doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
          specialization: doctor.specialization,
          department: doctor.department,
          consultationFee: doctor.consultationFee,
          yearsOfExperience: doctor.yearsOfExperience,
          bio: doctor.bio,
          status: 'UNAVAILABLE',
          availableSlotCount: 0,
          nextAvailableSlot: null,
          reason: fullDayBlock
            ? `On leave: ${(fullDayBlock.blockingInfo?.reason || 'unavailable').toLowerCase().replace(/_/g, ' ')}`
            : schedule.reason,
          doctor
        };
      }

      const avail = await getSlotAvailability(doctor._id.toString(), dateStr, patientId);

      return {
        doctorId: doctor._id,
        doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
        specialization: doctor.specialization,
        department: doctor.department,
        consultationFee: doctor.consultationFee,
        yearsOfExperience: doctor.yearsOfExperience,
        bio: doctor.bio,
        status: avail.availableSlotCount > 0 ? 'AVAILABLE' : 'FULLY_BOOKED',
        availableSlotCount: avail.availableSlotCount,
        nextAvailableSlot: avail.nextAvailableSlot,
        reason: avail.availableSlotCount === 0 ? 'No available slots for this date' : null,
        doctor
      };
    } catch {
      return {
        doctorId: doctor._id,
        doctorName: `Dr. ${doctor.firstName} ${doctor.lastName}`,
        specialization: doctor.specialization,
        department: doctor.department,
        status: 'UNAVAILABLE',
        availableSlotCount: 0,
        nextAvailableSlot: null,
        reason: 'Availability information temporarily unavailable',
        doctor
      };
    }
  }));
};

/**
 * Check whether a doctor is available for a specific appointment slot.
 * Returns { available: boolean, reason?: string, capacity?: number, bookedCount?: number }
 * Used by the booking route as an extra validation step.
 */
const checkBookingEligibility = async (doctorId, dateStr, time, duration) => {
  const doctor = await User.findOne({ _id: doctorId, role: 'doctor', isActive: true })
    .select('isActive availability workingDays workingHours')
    .lean();

  if (!doctor) return { available: false, reason: 'Doctor not found or inactive' };

  // Check working schedule
  const schedule = getDoctorScheduleForDate(doctor, dateStr);
  if (!schedule.available) return { available: false, reason: schedule.reason };

  // Check if slot time is within working hours
  const [sH, sM] = time.split(':').map(Number);
  const slotStart = sH * 60 + sM;
  const slotEnd   = slotStart + duration;
  const workStart = toMinutes(schedule.startTime);
  const workEnd   = toMinutes(schedule.endTime);
  if (slotStart < workStart || slotEnd > workEnd) {
    return { available: false, reason: `This time is outside the doctor's working hours (${schedule.startTime} – ${schedule.endTime})` };
  }

  const startOfDay = new Date(dateStr); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(dateStr); endOfDay.setHours(23, 59, 59, 999);

  // Check for a blocking DoctorSlot
  const blockingSlot = await DoctorSlot.findOne({
    doctor: doctorId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ['BLOCKED', 'CANCELLED'] },
    $expr: {
      $and: [
        { $lt: [{ $toInt: { $replaceAll: { input: '$startTime', find: ':', replacement: '' } } }, slotEnd] },
        { $gt: [{ $toInt: { $replaceAll: { input: '$endTime', find: ':', replacement: '' } } }, slotStart] }
      ]
    }
  }).lean();

  // Simpler blocking check using in-memory approach
  const allBlocking = await DoctorSlot.find({
    doctor: doctorId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ['BLOCKED', 'CANCELLED'] }
  }).select('startTime endTime blockingInfo').lean();

  const blocked = allBlocking.find(ds => {
    const dsStart = toMinutes(ds.startTime);
    const dsEnd   = toMinutes(ds.endTime);
    return slotStart < dsEnd && slotEnd > dsStart;
  });

  if (blocked) {
    const raw = blocked.blockingInfo?.reason || 'unavailable';
    return { available: false, reason: `Doctor unavailable for this slot: ${raw.toLowerCase().replace(/_/g, ' ')}` };
  }

  // Check slot capacity
  const matchingSlot = await DoctorSlot.findOne({
    doctor: doctorId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ['AVAILABLE', 'BOOKED'] }
  }).lean();

  const capacity = matchingSlot?.maxPatients ?? 1;
  const bookedCount = await Appointment.countDocuments({
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    appointmentTime: time,
    status: { $in: ACTIVE_BOOKING_STATUSES }
  });

  if (bookedCount >= capacity) {
    return { available: false, reason: 'This doctor is fully booked for the selected time slot.', capacity, bookedCount };
  }

  return { available: true, capacity, bookedCount };
};

module.exports = { getSlotAvailability, getAvailableDoctors, checkBookingEligibility, getDoctorScheduleForDate, ACTIVE_BOOKING_STATUSES };
