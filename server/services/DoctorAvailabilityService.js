const DoctorSlot = require('../models/DoctorSlot');
const User = require('../models/User');

// A doctor is "off" on a given date for either of two reasons:
//   1. Weekly schedule: today's weekday is NOT one of the doctor's workingDays
//      (e.g. doctor works Mon–Fri, so on a Saturday — or after removing Friday —
//      they are off). This is the primary, recurring signal.
//   2. One-off leave: the leave flow wrote a full-day BLOCKED DoctorSlot (00:00).
// Rooms and check-in react to this so a doctorless room can't take patients.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Interpret a Date or 'YYYY-MM-DD' string in local time (leave slots and the
// weekday are both computed against the hospital's local day).
const toLocalDate = (date = new Date()) => {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(date);
};

const toLocalDayRange = (date = new Date()) => {
  const d = toLocalDate(date);
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return { start, end };
};

// Name of the weekday for a date, e.g. 'Friday'.
const weekdayName = (date = new Date()) => WEEKDAY_NAMES[toLocalDate(date).getDay()];

// True if this doctor does not work on the given weekday. A doctor with no
// workingDays set at all is treated as available (we don't block on missing data).
const isOffByWeekday = (workingDays, dayName) => {
  if (!Array.isArray(workingDays) || workingDays.length === 0) return false;
  const target = dayName.toLowerCase();
  return !workingDays.some((d) => String(d).toLowerCase() === target);
};

// True if the doctor's per-day availability object explicitly marks this weekday
// as disabled (enabled === false). Only fires when the availability object exists
// AND the specific day key is present — absence is treated as "no opinion" so
// doctors who have never set the field stay available.
//
// The User model stores availability as:
//   { monday: { enabled: Boolean, startTime, endTime }, tuesday: { … }, … }
const isOffByAvailabilityObj = (availability, dayName) => {
  if (!availability || typeof availability !== 'object') return false;
  const key = dayName.toLowerCase();
  const dayConfig = availability[key];
  // Only mark as off when the field is explicitly set to false.
  // undefined / null / missing key → treat as available.
  return dayConfig != null && dayConfig.enabled === false;
};

// Set of doctor id strings who are off (weekly schedule OR full-day leave) on the date.
async function getUnavailableDoctorIds(date = new Date()) {
  const { start, end } = toLocalDayRange(date);
  const dayName = weekdayName(date);

  const [blockedSlots, doctors] = await Promise.all([
    DoctorSlot.find({
      status: 'BLOCKED',
      startTime: '00:00',
      date: { $gte: start, $lte: end }
    }).select('doctor').lean(),
    // Select both availability signals so we catch doctors off via either path.
    User.find({ role: 'doctor' }).select('_id workingDays availability').lean()
  ]);

  const off = new Set(blockedSlots.map((s) => String(s.doctor)));
  for (const doc of doctors) {
    if (
      isOffByWeekday(doc.workingDays, dayName) ||
      isOffByAvailabilityObj(doc.availability, dayName)
    ) {
      off.add(String(doc._id));
    }
  }
  return off;
}

// True if the given doctor is off (weekly schedule OR full-day leave) on the date.
async function isDoctorUnavailable(doctorId, date = new Date()) {
  const { start, end } = toLocalDayRange(date);

  const leave = await DoctorSlot.findOne({
    doctor: doctorId,
    status: 'BLOCKED',
    startTime: '00:00',
    date: { $gte: start, $lte: end }
  }).select('_id').lean();
  if (leave) return true;

  // Check both availability signals.
  const doctor = await User.findOne({ _id: doctorId, role: 'doctor' })
    .select('workingDays availability')
    .lean();

  if (!doctor) return false;
  const dayName = weekdayName(date);
  return (
    isOffByWeekday(doctor.workingDays, dayName) ||
    isOffByAvailabilityObj(doctor.availability, dayName)
  );
}

module.exports = {
  getUnavailableDoctorIds,
  isDoctorUnavailable,
  toLocalDayRange,
  weekdayName,
  isOffByWeekday,
  isOffByAvailabilityObj,   // exported for unit tests
};
