/**
 * The tracker page's epic grouping as the shared chart reads it. The cases that matter: a row goes under its ticket's primary epic, a
 * review row under the epic of the ticket it reviews, and a row of no epic or no ticket under the "No epic" head; a ticket's other epics
 * are squares on its own row only; and each epic's group carries its chip, its roll-up span titled by the epic, its open mark, its done
 * count and its shared tickets.
 */

import { describe, expect, test } from 'bun:test';

import type { BoardEpic }     from '../@types/PageBoard.ts';
import { NO_EPIC_CHIP }       from '../constants/EpicChips.ts';
import { rowGroupingOfEpics } from './EpicRowGrouping.ts';

const NO_TICKETS: BoardEpic['ticketCountByStatus'] = {
  'draft':       0,
  'pending':     0,
  'in-progress': 0,
  'in-review':   0,
  'reviewed':    0,
  'delivered':   0,
  'abandoned':   0,
};

function exampleEpic(key: string, slot: number, changes: Partial<BoardEpic> = {}): BoardEpic {
  return {
    key,
    title:               `Example ${key}`,
    slot,
    ticketIds:           [],
    ticketCountByStatus: NO_TICKETS,
    tokens:              0,
    span:                null,
    descriptionHtml:     '',
    ...changes,
  };
}

const CHECKOUT = exampleEpic('checkout', 1, {
  ticketIds:           ['001'],
  ticketCountByStatus: { ...NO_TICKETS, 'in-progress': 1 },
  span:                { start: '2026-09-18T20:30:00+02:00', end: null },
});
const BILLING  = exampleEpic('billing', 2, { ticketIds: ['001', '002'], ticketCountByStatus: { ...NO_TICKETS, delivered: 2 } });

const EPICS_OF_TICKET = new Map<string, readonly BoardEpic[]>([['001', [CHECKOUT, BILLING]], ['002', [BILLING]]]);

const GROUPING = rowGroupingOfEpics([CHECKOUT, BILLING], EPICS_OF_TICKET);

describe('rowGroupingOfEpics', () => {
  test('puts a row under its ticket\'s primary epic, a review row under its ticket\'s, and the rest under no group', () => {
    expect(GROUPING.groupKeyOfRow({ ticket: '001' })).toBe('checkout');
    expect(GROUPING.groupKeyOfRow({ ticket: '002' })).toBe('billing');
    expect(GROUPING.groupKeyOfRow({ ticket: null, ownRowOfReviewedTicket: { ticket: '002' } })).toBe('billing');
    expect(GROUPING.groupKeyOfRow({ ticket: null, reviewOf: '001' })).toBe('checkout');
    expect(GROUPING.groupKeyOfRow({ ticket: '003' })).toBeNull();
    expect(GROUPING.groupKeyOfRow({ ticket: null })).toBeNull();
    expect(GROUPING.ungroupedHead).toEqual({ key: NO_EPIC_CHIP, label: 'No epic' });
  });

  test('carries each epic\'s chip, span titled by the epic, open mark, done count and shared tickets', () => {
    const [checkout, billing] = GROUPING.groups;

    expect(checkout).toMatchObject({
      key:               'checkout',
      slot:              1,
      span:              { start: '2026-09-18T20:30:00+02:00', end: null, label: 'Example checkout' },
      isOpen:            true,
      doneText:          '0 / 1 done',
      sharedMemberCount: 0,
    });
    expect(checkout?.chipMarkup).toContain('data-epic="checkout"');
    expect(billing).toMatchObject({
      span: null, isOpen: false, doneText: '2 / 2 done', sharedMemberCount: 1
    });
  });
});
