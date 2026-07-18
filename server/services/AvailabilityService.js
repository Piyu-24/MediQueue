// Appointment statuses that consume a slot / count as an active booking.
// 'booked' is the initial status for token-based (General OPD block) bookings.
const ACTIVE_BOOKING_STATUSES = [
  'booked',
  'scheduled', 'confirmed', 'checked_in', 'in_queue',
  'in-progress', 'in_consultation', 'late', 'delayed', 'skipped'
];

module.exports = { ACTIVE_BOOKING_STATUSES };
