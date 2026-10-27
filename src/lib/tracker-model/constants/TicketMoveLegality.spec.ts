/**
 * The ticket move graph: every status but `draft` is reachable, and none from itself. Filing is the only way into `draft`, so no source
 * status reaches it, and a draft leaves only for `pending` (through `ticket ready`) or `abandoned`.
 */
import { describe, expect, test } from 'bun:test';

import { TicketMoveUtil }                          from '../utils/TicketMoveUtil.ts';
import { TICKET_STATUSES }                         from './Statuses.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS } from './TicketMoveLegality.ts';

describe('the legality matrix', () => {
  test('every target but draft is reachable from at least one status, and from none that equals it', () => {
    for (const [target, sources] of Object.entries(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS)) {
      if (target !== 'draft') expect(sources.length, target).toBeGreaterThan(0);
      expect(sources, target).not.toContain(target);
    }
    expect(Object.keys(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS).sort()).toEqual([...TICKET_STATUSES].sort());
  });

  test('no source status reaches draft, each planted', () => {
    expect(TICKET_STATUSES.length, 'the statuses were enumerated').toBeGreaterThan(5);
    for (const status of TICKET_STATUSES) expect(TicketMoveUtil.ticketMoveIsLegal(status, 'draft'), status).toBe(false);
  });

  test('a draft moves on only to pending or abandoned', () => {
    const targets = TICKET_STATUSES.filter((target) => TicketMoveUtil.ticketMoveIsLegal('draft', target));
    expect(targets).toEqual(['pending', 'abandoned']);
  });
});
