/**
 * The four stamps a ticket carries after a move. What callers rely on: a stamp already written stays where it was, `abandonedAt` follows
 * the latest decision, and a reopen clears all four and asks for the reason to go, since the work starts over.
 */
import { expect, test } from 'bun:test';

import type { TicketStatus }                  from '../@types/Ticket.ts';
import { TicketStampUtil, type TicketStamps } from './TicketStampUtil.ts';

const { stampsAfterMoveOf } = TicketStampUtil;

const STARTED_AT   = '2026-09-18T10:00:00+02:00';
const FINISHED_AT  = '2026-09-18T12:00:00+02:00';
const ABANDONED_AT = '2026-09-18T13:00:00+02:00';
const DELIVERED_AT = '2026-09-18T15:00:00+02:00';
const MOVED_AT     = '2026-09-18T16:00:00+02:00';

const UNSTAMPED: TicketStamps = {
  started:     null,
  finished:    null,
  delivered:   null,
  abandonedAt: null,
};

const FULLY_STAMPED: TicketStamps = {
  started:     STARTED_AT,
  finished:    FINISHED_AT,
  delivered:   DELIVERED_AT,
  abandonedAt: ABANDONED_AT,
};

test('each move stamps only the moment it reaches, and only when that stamp is still empty', () => {
  const expectedForUnstamped: Record<Exclude<TicketStatus, 'pending'>, TicketStamps> = {
    'in-progress': { ...UNSTAMPED, started: MOVED_AT },
    'in-review':   { ...UNSTAMPED, finished: MOVED_AT },
    reviewed:      { ...UNSTAMPED, finished: MOVED_AT },
    delivered:     { ...UNSTAMPED, delivered: MOVED_AT },
    abandoned:     { ...UNSTAMPED, abandonedAt: MOVED_AT },
  };
  for (const [targetStatus, expected] of Object.entries(expectedForUnstamped) as Array<[TicketStatus, TicketStamps]>) {
    expect(stampsAfterMoveOf(UNSTAMPED, targetStatus, MOVED_AT), targetStatus).toEqual({ ...expected, clearsReason: false });
  }
  for (const targetStatus of ['in-progress', 'in-review', 'reviewed', 'delivered'] as const) {
    expect(stampsAfterMoveOf(FULLY_STAMPED, targetStatus, MOVED_AT), targetStatus).toEqual({ ...FULLY_STAMPED, clearsReason: false });
  }
});

// Abandoning twice is deciding twice, so the stamp moves to the latest decision rather than keeping the first.
test('abandoning twice moves abandonedAt to the second decision', () => {
  expect(stampsAfterMoveOf(FULLY_STAMPED, 'abandoned', MOVED_AT)).toEqual({ ...FULLY_STAMPED, abandonedAt: MOVED_AT, clearsReason: false });
});

test('a reopen clears all four stamps and asks for the reason to be cleared', () => {
  expect(stampsAfterMoveOf(FULLY_STAMPED, 'pending', MOVED_AT)).toEqual({ ...UNSTAMPED, clearsReason: true });
});

test('leaves the stamps it was given untouched', () => {
  const stamps = { ...UNSTAMPED };
  stampsAfterMoveOf(stamps, 'in-progress', MOVED_AT);
  expect(stamps).toEqual(UNSTAMPED);
});
