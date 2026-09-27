/** The ticket move graph: every status is reachable, and none from itself. */
import { describe, expect, test } from 'bun:test';

import { TICKET_STATUSES }                         from './Statuses.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS } from './TicketMoveLegality.ts';

describe('the legality matrix', () => {
  test('every target is reachable from at least one status, and from none that equals it', () => {
    for (const [target, sources] of Object.entries(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS)) {
      expect(sources.length, target).toBeGreaterThan(0);
      expect(sources, target).not.toContain(target);
    }
    expect(Object.keys(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS).sort()).toEqual([...TICKET_STATUSES].sort());
  });
});
