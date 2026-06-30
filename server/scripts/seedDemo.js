/**
 * seedDemo.js — Legacy entry point. Forwards to the split seed scripts.
 *
 * Prefer running the focused seeds directly:
 *
 *   node server/scripts/seeds/seed-all.js              # everything
 *   node server/scripts/seeds/seed-users.js            # users + health cards only
 *   node server/scripts/seeds/seed-departments.js      # departments + time blocks
 *   node server/scripts/seeds/seed-appointments.js     # appointments only
 *   node server/scripts/seeds/seed-queue.js            # queue sessions + entries
 *   node server/scripts/seeds/seed-medical-records.js  # records + prescriptions
 *   node server/scripts/seeds/seed-notifications.js    # notifications
 *
 * All accept --reset to wipe their own collection before seeding.
 */

require('./seeds/seed-all');
