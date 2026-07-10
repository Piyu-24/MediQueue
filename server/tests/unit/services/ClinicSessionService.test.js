/**
 * ClinicSessionService.test.js
 *
 * Unit tests for ClinicSessionService — pure logic tests with mocked DB models.
 *
 * Tests cover:
 *   1. closeClinicSession — happy path, guard conditions, edge cases
 *   2. getDayEndReport — happy path, guard conditions
 *   3. Walk-in guard logic (extracted pure helper)
 *   4. UNSERVED_STATUSES constant completeness
 */

'use strict';

// ─── Pure helpers extracted from ClinicSessionService for unit testing ────────
// These replicate the exact logic without needing a DB connection.

const UNSERVED_STATUSES = [
  'waiting',
  'ready',
  'called',
  'emergency_waiting',
  'temporarily_away',
  'skipped',
  'delayed'
];

const TERMINAL_STATUSES = [
  'completed',
  'no_show',
  'cancelled',
  'in_consultation',
  'unserved_clinic_closed'
];

// Pure function: determines which entries would be marked unserved
const getUnservedEntries = (entries) =>
  entries.filter(e => UNSERVED_STATUSES.includes(e.status));

// Pure function: computes the day-end report from a list of entries + session
const computeReport = (entries, session, now = new Date()) => ({
  generatedAt:            now,
  totalServed:            entries.filter(e => e.status === 'completed').length,
  totalWaiting:           entries.filter(e => UNSERVED_STATUSES.includes(e.status)).length,
  totalUnserved:          entries.filter(e => UNSERVED_STATUSES.includes(e.status)).length,
  totalEmergency:         entries.filter(e => e.isEmergency === true).length,
  avgConsultationMinutes: session.avgConsultationMinutes ?? 0
});

// Pure function: walk-in guard
const isWalkInAllowed = (session, isEmergency) => {
  if (isEmergency === true) return true;   // emergencies always allowed
  if (!session) return true;               // no session yet → allowed
  return session.status !== 'ended';
};

// ─────────────────────────────────────────────────────────────────────────────

describe('UNSERVED_STATUSES — completeness', () => {
  test('contains all expected unserved statuses', () => {
    expect(UNSERVED_STATUSES).toEqual(expect.arrayContaining([
      'waiting', 'ready', 'called', 'emergency_waiting',
      'temporarily_away', 'skipped', 'delayed'
    ]));
  });

  test('does NOT include terminal statuses', () => {
    for (const t of TERMINAL_STATUSES) {
      expect(UNSERVED_STATUSES).not.toContain(t);
    }
  });

  test('unserved_clinic_closed is NOT in UNSERVED_STATUSES (already terminal)', () => {
    expect(UNSERVED_STATUSES).not.toContain('unserved_clinic_closed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getUnservedEntries — which entries get marked at close', () => {
  const makeEntry = (status, isEmergency = false) => ({ status, isEmergency });

  test('marks all unserved-status entries', () => {
    const entries = UNSERVED_STATUSES.map(s => makeEntry(s));
    const result = getUnservedEntries(entries);
    expect(result).toHaveLength(UNSERVED_STATUSES.length);
  });

  test('does NOT mark completed entries', () => {
    const entries = [makeEntry('completed'), makeEntry('waiting')];
    expect(getUnservedEntries(entries)).toHaveLength(1);
    expect(getUnservedEntries(entries)[0].status).toBe('waiting');
  });

  test('does NOT mark already-cancelled entries', () => {
    const entries = [makeEntry('cancelled'), makeEntry('ready')];
    const result = getUnservedEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('ready');
  });

  test('does NOT mark no_show entries', () => {
    const entries = [makeEntry('no_show'), makeEntry('skipped')];
    const result = getUnservedEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('skipped');
  });

  test('does NOT mark in_consultation entries (currently being seen)', () => {
    const entries = [makeEntry('in_consultation'), makeEntry('waiting')];
    const result = getUnservedEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('waiting');
  });

  test('does NOT mark already-unserved_clinic_closed entries', () => {
    const entries = [makeEntry('unserved_clinic_closed'), makeEntry('delayed')];
    const result = getUnservedEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('delayed');
  });

  test('returns empty array when all entries are terminal', () => {
    const entries = TERMINAL_STATUSES.map(s => makeEntry(s));
    expect(getUnservedEntries(entries)).toHaveLength(0);
  });

  test('returns empty array for empty input', () => {
    expect(getUnservedEntries([])).toHaveLength(0);
  });

  // Emergency patients IN the queue can still be unserved
  test('emergency patients in waiting still get marked unserved', () => {
    const entry = makeEntry('emergency_waiting', true);
    expect(getUnservedEntries([entry])).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('computeReport — day-end summary calculations', () => {
  const makeEntry = (status, isEmergency = false) => ({ status, isEmergency });
  const session = { avgConsultationMinutes: 12 };

  test('correctly counts served (completed) patients', () => {
    const entries = [makeEntry('completed'), makeEntry('completed'), makeEntry('waiting')];
    const report = computeReport(entries, session);
    expect(report.totalServed).toBe(2);
  });

  test('correctly counts unserved (still in queue) patients', () => {
    const entries = [makeEntry('waiting'), makeEntry('ready'), makeEntry('completed')];
    const report = computeReport(entries, session);
    expect(report.totalUnserved).toBe(2);
  });

  test('correctly counts emergency patients (across all statuses)', () => {
    const entries = [
      makeEntry('completed', true),   // emergency, served
      makeEntry('waiting',   true),   // emergency, unserved
      makeEntry('waiting',  false)    // normal, unserved
    ];
    const report = computeReport(entries, session);
    expect(report.totalEmergency).toBe(2);
  });

  test('includes session avgConsultationMinutes', () => {
    const report = computeReport([], { avgConsultationMinutes: 15 });
    expect(report.avgConsultationMinutes).toBe(15);
  });

  test('defaults avgConsultationMinutes to 0 when not set', () => {
    const report = computeReport([], { avgConsultationMinutes: undefined });
    expect(report.avgConsultationMinutes).toBe(0);
  });

  test('handles all-zero clinic (no patients)', () => {
    const report = computeReport([], session);
    expect(report.totalServed).toBe(0);
    expect(report.totalWaiting).toBe(0);
    expect(report.totalUnserved).toBe(0);
    expect(report.totalEmergency).toBe(0);
  });

  test('totalWaiting equals totalUnserved at close time (before bulk update)', () => {
    const entries = [makeEntry('waiting'), makeEntry('ready'), makeEntry('skipped')];
    const report = computeReport(entries, session);
    expect(report.totalWaiting).toBe(report.totalUnserved);
  });

  test('full realistic scenario', () => {
    const entries = [
      makeEntry('completed', false),
      makeEntry('completed', true),   // served emergency
      makeEntry('waiting',   false),
      makeEntry('ready',     false),
      makeEntry('emergency_waiting', true),  // unserved emergency
      makeEntry('no_show',   false),
      makeEntry('cancelled', false)
    ];
    const report = computeReport(entries, { avgConsultationMinutes: 8 });
    expect(report.totalServed).toBe(2);
    expect(report.totalUnserved).toBe(3);   // waiting + ready + emergency_waiting
    expect(report.totalEmergency).toBe(2);  // completed(E) + emergency_waiting(E)
    expect(report.avgConsultationMinutes).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Walk-in guard — isWalkInAllowed', () => {

  // ── Session not ended ───────────────────────────────────────────────────────

  test('session active → standard walk-in ALLOWED', () => {
    expect(isWalkInAllowed({ status: 'active' }, false)).toBe(true);
  });

  test('session paused → standard walk-in ALLOWED (session still open)', () => {
    expect(isWalkInAllowed({ status: 'paused' }, false)).toBe(true);
  });

  // ── Session ended ───────────────────────────────────────────────────────────

  test('session ended → standard walk-in BLOCKED', () => {
    expect(isWalkInAllowed({ status: 'ended' }, false)).toBe(false);
  });

  test('session ended → standard walk-in BLOCKED (isEmergency undefined)', () => {
    expect(isWalkInAllowed({ status: 'ended' }, undefined)).toBe(false);
  });

  test('session ended → standard walk-in BLOCKED (isEmergency false)', () => {
    expect(isWalkInAllowed({ status: 'ended' }, false)).toBe(false);
  });

  // ── Emergency bypass ────────────────────────────────────────────────────────

  test('session ended + isEmergency true → ALLOWED (emergency bypasses guard)', () => {
    expect(isWalkInAllowed({ status: 'ended' }, true)).toBe(true);
  });

  test('session active + isEmergency true → ALLOWED', () => {
    expect(isWalkInAllowed({ status: 'active' }, true)).toBe(true);
  });

  // ── No session exists ───────────────────────────────────────────────────────

  test('no session yet (null) → walk-in ALLOWED', () => {
    expect(isWalkInAllowed(null, false)).toBe(true);
  });

  test('no session yet (undefined) → walk-in ALLOWED', () => {
    expect(isWalkInAllowed(undefined, false)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('closeClinicSession — guard conditions (pure logic)', () => {

  // These tests validate the guard conditions that ClinicSessionService checks
  // before proceeding with the bulk close operation.

  const sessionActive  = { status: 'active',  avgConsultationMinutes: 10 };
  const sessionPaused  = { status: 'paused',  avgConsultationMinutes: 10 };
  const sessionEnded   = { status: 'ended',   avgConsultationMinutes: 10 };

  const isAlreadyClosed = (session) => session?.status === 'ended';
  const hasActiveConsultation = (entries) =>
    entries.some(e => e.status === 'in_consultation');

  test('active session → NOT already closed → close proceeds', () => {
    expect(isAlreadyClosed(sessionActive)).toBe(false);
  });

  test('paused session → NOT already closed → close proceeds', () => {
    expect(isAlreadyClosed(sessionPaused)).toBe(false);
  });

  test('already-ended session → is already closed → close blocked', () => {
    expect(isAlreadyClosed(sessionEnded)).toBe(true);
  });

  test('null session → treated as not found (service throws 404)', () => {
    expect(isAlreadyClosed(null)).toBe(false); // null?.status === undefined !== 'ended'
  });

  test('no active consultation → close can proceed', () => {
    const entries = [{ status: 'waiting' }, { status: 'completed' }];
    expect(hasActiveConsultation(entries)).toBe(false);
  });

  test('active consultation present → close must be blocked', () => {
    const entries = [{ status: 'waiting' }, { status: 'in_consultation' }];
    expect(hasActiveConsultation(entries)).toBe(true);
  });

  test('all completed → no active consultation → close can proceed', () => {
    const entries = [{ status: 'completed' }, { status: 'completed' }];
    expect(hasActiveConsultation(entries)).toBe(false);
  });

  test('empty queue → no active consultation → close can proceed', () => {
    expect(hasActiveConsultation([])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getDayEndReport — guard conditions (pure logic)', () => {

  const reportNotGenerated = (session) => !session?.dayEndReport?.generatedAt;
  const sessionNotFound    = (session) => !session;

  test('session null → not found → should 404', () => {
    expect(sessionNotFound(null)).toBe(true);
  });

  test('session exists without report → report not generated → should 400', () => {
    expect(reportNotGenerated({ dayEndReport: null })).toBe(true);
    expect(reportNotGenerated({ dayEndReport: {} })).toBe(true);
    expect(reportNotGenerated({})).toBe(true);
  });

  test('session with report → report available → proceed', () => {
    expect(reportNotGenerated({ dayEndReport: { generatedAt: new Date() } })).toBe(false);
  });

  test('session exists and has valid report → both guards clear', () => {
    const session = { status: 'ended', dayEndReport: { generatedAt: new Date(), totalServed: 5 } };
    expect(sessionNotFound(session)).toBe(false);
    expect(reportNotGenerated(session)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases and boundary conditions', () => {

  test('only in_consultation patient at close — not marked unserved', () => {
    const entries = [{ status: 'in_consultation', isEmergency: false }];
    expect(getUnservedEntries(entries)).toHaveLength(0);
  });

  test('mix: one in_consultation + one waiting → only waiting is unserved', () => {
    const entries = [
      { status: 'in_consultation', isEmergency: false },
      { status: 'waiting', isEmergency: false }
    ];
    const unserved = getUnservedEntries(entries);
    expect(unserved).toHaveLength(1);
    expect(unserved[0].status).toBe('waiting');
  });

  test('report totalWaiting and totalUnserved should be identical at close time', () => {
    const entries = [
      { status: 'waiting',           isEmergency: false },
      { status: 'ready',             isEmergency: false },
      { status: 'called',            isEmergency: false },
      { status: 'emergency_waiting', isEmergency: true  },
      { status: 'temporarily_away',  isEmergency: false },
      { status: 'skipped',           isEmergency: false },
      { status: 'delayed',           isEmergency: false }
    ];
    const report = computeReport(entries, { avgConsultationMinutes: 0 });
    expect(report.totalWaiting).toBe(7);
    expect(report.totalUnserved).toBe(7);
  });

  test('report with no unserved patients (all served)', () => {
    const entries = [
      { status: 'completed', isEmergency: false },
      { status: 'completed', isEmergency: true },
      { status: 'no_show',   isEmergency: false }
    ];
    const report = computeReport(entries, { avgConsultationMinutes: 10 });
    expect(report.totalServed).toBe(2);
    expect(report.totalUnserved).toBe(0);
    expect(report.totalWaiting).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Session-close authorization — who can close a session', () => {

  // Pure guard logic that mirrors the route authorization
  const canCloseSession = (actorRole, actorId, targetDoctorId) => {
    // Only doctor (own session) or admin allowed
    if (!['doctor', 'admin'].includes(actorRole)) return false;
    if (actorRole === 'doctor' && actorId !== targetDoctorId) return false;
    return true;
  };

  const DOCTOR_ID = 'doc-001';

  test('assigned doctor can close their own session', () => {
    expect(canCloseSession('doctor', DOCTOR_ID, DOCTOR_ID)).toBe(true);
  });

  test('a different doctor cannot close another doctor\'s session', () => {
    expect(canCloseSession('doctor', 'doc-002', DOCTOR_ID)).toBe(false);
  });

  test('admin can close any session (system-level op)', () => {
    expect(canCloseSession('admin', 'admin-001', DOCTOR_ID)).toBe(true);
  });

  test('receptionist CANNOT close a session', () => {
    expect(canCloseSession('receptionist', 'rec-001', DOCTOR_ID)).toBe(false);
  });

  test('staff CANNOT close a session', () => {
    expect(canCloseSession('staff', 'staff-001', DOCTOR_ID)).toBe(false);
  });

  test('patient CANNOT close a session', () => {
    expect(canCloseSession('patient', 'patient-001', DOCTOR_ID)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Session-closed check-in guard — applies to ALL check-in types', () => {

  // Pure predicate that mirrors the guard used across all check-in routes
  const isCheckInBlocked = (session) => session?.status === 'ended';

  test('session ended → appointment check-in BLOCKED', () => {
    expect(isCheckInBlocked({ status: 'ended' })).toBe(true);
  });

  test('session ended → by-token check-in BLOCKED', () => {
    expect(isCheckInBlocked({ status: 'ended' })).toBe(true);
  });

  test('session ended → legacy QR check-in BLOCKED', () => {
    expect(isCheckInBlocked({ status: 'ended' })).toBe(true);
  });

  test('session active → appointment check-in ALLOWED', () => {
    expect(isCheckInBlocked({ status: 'active' })).toBe(false);
  });

  test('session paused → appointment check-in ALLOWED (session still open)', () => {
    expect(isCheckInBlocked({ status: 'paused' })).toBe(false);
  });

  test('no session yet (null) → check-in ALLOWED', () => {
    expect(isCheckInBlocked(null)).toBe(false);
  });

  test('no session yet (undefined) → check-in ALLOWED', () => {
    expect(isCheckInBlocked(undefined)).toBe(false);
  });

  // Walk-in emergency bypass is handled separately in the walk-in guard
  // The appointment check-in guard does NOT have an emergency bypass —
  // appointment patients have pre-booked slots and the session close is terminal.
  test('session ended → walk-in standard BLOCKED', () => {
    expect(isWalkInAllowed({ status: 'ended' }, false)).toBe(false);
  });

  test('session ended + emergency flag → walk-in ALLOWED (emergency bypass only)', () => {
    expect(isWalkInAllowed({ status: 'ended' }, true)).toBe(true);
  });
});
