// Statuses that count as an active booking (they use up a slot).
// 'booked' is the starting status for General OPD block bookings.
const ACTIVE_BOOKING_STATUSES = [
  'booked',
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

module.exports = { ACTIVE_BOOKING_STATUSES };
