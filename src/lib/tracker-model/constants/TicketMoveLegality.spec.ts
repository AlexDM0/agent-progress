/**
 * The ticket move graph: every status is reachable and none from itself, the documented pipeline is legal at every step,
 * and the moves that would skip it are refused.
 */
import { describe, expect, test } from 'bun:test';

import { TICKET_STATUSES }                                            from './Statuses';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS, ticketMoveIsLegal } from './TicketMoveLegality';

describe('the legality matrix', () => {
  test('every target is reachable from at least one status, and from none that equals it', () => {
    for (const [target, sources] of Object.entries(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS)) {
      expect(sources.length, target).toBeGreaterThan(0);
      expect(sources, target).not.toContain(target);
    }
    expect(Object.keys(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS).sort()).toEqual([...TICKET_STATUSES].sort());
  });

  test('the pipeline the skill documents is legal at every step', () => {
    expect(ticketMoveIsLegal('pending', 'in-progress')).toBe(true);
    expect(ticketMoveIsLegal('in-progress', 'in-review')).toBe(true);
    expect(ticketMoveIsLegal('in-review', 'reviewed')).toBe(true);
    expect(ticketMoveIsLegal('reviewed', 'delivered')).toBe(true);
    expect(ticketMoveIsLegal('in-progress', 'reviewed')).toBe(true);
    expect(ticketMoveIsLegal('in-review', 'in-progress')).toBe(true);
  });

  test('the steps that skip the pipeline are refused', () => {
    expect(ticketMoveIsLegal('pending', 'delivered')).toBe(false);
    expect(ticketMoveIsLegal('pending', 'in-review')).toBe(false);
    expect(ticketMoveIsLegal('pending', 'reviewed')).toBe(false);
    expect(ticketMoveIsLegal('delivered', 'in-progress')).toBe(false);
  });

  test('abandon reaches anything but the two end states; reopen anything but pending', () => {
    for (const status of ['pending', 'in-progress', 'in-review', 'reviewed'] as const) {
      expect(ticketMoveIsLegal(status, 'abandoned'), status).toBe(true);
      expect(ticketMoveIsLegal(status === 'pending' ? 'reviewed' : status, 'pending'), status).toBe(true);
    }
    expect(ticketMoveIsLegal('delivered', 'abandoned')).toBe(false);
    expect(ticketMoveIsLegal('abandoned', 'abandoned')).toBe(false);
    expect(ticketMoveIsLegal('pending', 'pending')).toBe(false);
  });
});
