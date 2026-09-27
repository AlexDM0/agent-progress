/**
 * The retired ticket words read as their replacements, and every other text, a current status or a word nobody knows, comes back as
 * stored, so the parse still accepts the one and refuses the other.
 */
import { describe, expect, test } from 'bun:test';

import { TICKET_STATUSES }         from '../../../lib/tracker-model/constants/Statuses.ts';
import { TicketStatusUpgradeUtil } from './TicketStatusUpgradeUtil.ts';

describe('currentTicketStatusTextOf', () => {
  test.each([
    ['open', 'pending'],
    ['done', 'reviewed'],
  ])('reads the retired word %s as %s', (storedStatusText, currentStatus) => {
    expect(TicketStatusUpgradeUtil.currentTicketStatusTextOf(storedStatusText)).toBe(currentStatus);
  });

  test('leaves every current status as stored', () => {
    expect(TICKET_STATUSES.map(TicketStatusUpgradeUtil.currentTicketStatusTextOf)).toEqual([...TICKET_STATUSES]);
  });

  test('leaves a word nobody knows as stored, for the parse to refuse', () => {
    expect(TicketStatusUpgradeUtil.currentTicketStatusTextOf('finished-ish')).toBe('finished-ish');
  });
});
