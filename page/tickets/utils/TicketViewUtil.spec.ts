/**
 * The Tickets tab's search, chips and sort. The cases that matter: the search and the chips combine with AND, a body is searched by the
 * words a reader sees and never by its markup, a narrowed table looks past "Hide work finished", a chip counts what pressing it would add,
 * a ticket in two epics answers to both epic chips and one in none to the no-epic chip, and each column sorts both ways with the newest
 * ticket first on a tie, the Epic column by the primary epic's title.
 */

import { describe, expect, test }              from 'bun:test';
import type { PageTicket }                     from '../../../src/shared/@types/PagePayload.ts';
import type { BoardTicket }                    from '../../@types/PageBoard.ts';
import type { TicketView }                     from '../../@types/ViewerChoices.ts';
import { NO_EPIC_CHIP }                        from '../../constants/EpicChips.ts';
import { pageBoardFixture }                    from '../../testing/PageBoardFixture.ts';
import { DEFAULT_TICKET_VIEW, TicketViewUtil } from './TicketViewUtil.ts';

function exampleTicket(changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id:          '001',
    title:       'Example ticket',
    type:        'change',
    status:      'pending',
    filed:       '2026-09-18T20:44:00+02:00',
    updated:     '2026-09-18T20:44:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/001-example.md',
    bodyHtml:    '',
    ...changes,
  };
}

const ACCEPTANCE_BODY_HTML = '<h2>Acceptance</h2><p>The <code>&lt;dialog&gt;</code> closes on Esc &amp; blurs.</p>';

const TICKETS: readonly BoardTicket[] = pageBoardFixture({
  tasks:   [],
  tickets: [
    exampleTicket({
      id: '001', title: 'Dark mode for the account pages', type: 'feature', group: 'theme', epics: ['theming']
    }),
    exampleTicket({
      id: '002', title: 'Checkout double-submits', type: 'bug', branch: 'ticket/dark-checkout', epics: ['checkout-redesign', 'theming']
    }),
    exampleTicket({
      id: '003', title: 'Rename basket to cart', type: 'change', status: 'reviewed', bodyHtml: ACCEPTANCE_BODY_HTML
    }),
    exampleTicket({
      id: '004', title: 'Old idea', type: 'bug', status: 'abandoned', bodyHtml: '<p class="shadowed" title="nightfall">Plain words only.</p>'
    }),
    exampleTicket({
      id: '010', title: 'dark banner', type: 'bug', status: 'reviewed'
    }),
  ],
  epics: [
    {
      key: 'checkout-redesign', title: 'Checkout redesign', slot: 1, extra: []
    },
    {
      key: 'theming', title: 'Theming', slot: 2, extra: []
    },
  ],
}).tickets;

const SEARCHABLE_TEXT_BY_ID = new Map(TICKETS.map((ticket) => [ticket.id, TicketViewUtil.searchableTextOf(ticket)]));

function shownIds(view: Partial<TicketView>, visibleTickets: readonly BoardTicket[] = TICKETS): string[] {
  return TicketViewUtil.ticketsShownBy({ ...DEFAULT_TICKET_VIEW, ...view }, TICKETS, visibleTickets, SEARCHABLE_TEXT_BY_ID).map((ticket) => ticket.id);
}

describe('ticketsShownBy', () => {
  test('shows every ticket newest first by default', () => {
    expect(shownIds({})).toEqual(['010', '004', '003', '002', '001']);
  });

  test('searches the title, branch and group, whatever the case', () => {
    expect(shownIds({ searchText: '  DARK ' })).toEqual(['010', '002', '001']);
    expect(shownIds({ searchText: 'theme' })).toEqual(['001']);
  });

  test('combines the search with a chip as an AND, and the chips of one group as an OR', () => {
    expect(shownIds({ searchText: 'dark', typeChips: ['bug'] })).toEqual(['010', '002']);
    expect(shownIds({ searchText: 'dark', typeChips: ['bug'], statusChips: ['reviewed'] })).toEqual(['010']);
    expect(shownIds({ statusChips: ['reviewed', 'abandoned'] })).toEqual(['010', '004', '003']);
  });

  test('finds a ticket by the key or the title of any of its epics', () => {
    expect(shownIds({ searchText: 'checkout-redesign' })).toEqual(['002']);
    expect(shownIds({ searchText: 'theming' })).toEqual(['002', '001']);
  });

  test('keeps a ticket in any pressed epic, and the tickets in none under the no-epic chip', () => {
    expect(shownIds({ epicChips: ['theming'] })).toEqual(['002', '001']);
    expect(shownIds({ epicChips: ['checkout-redesign', NO_EPIC_CHIP] })).toEqual(['010', '004', '003', '002']);
    expect(shownIds({ epicChips: ['theming'], typeChips: ['feature'] })).toEqual(['001']);
  });

  test('finds a phrase that occurs only in a ticket body, with its escaped characters read back', () => {
    expect(shownIds({ searchText: 'closes on esc & blurs' })).toEqual(['003']);
    expect(shownIds({ searchText: '<dialog>' })).toEqual(['003']);
    expect(shownIds({ searchText: 'acceptance' })).toEqual(['003']);
  });

  test('never finds a word that occurs only inside a tag or an attribute of the body', () => {
    expect(shownIds({ searchText: 'shadowed' })).toEqual([]);
    expect(shownIds({ searchText: 'nightfall' })).toEqual([]);
    expect(shownIds({ searchText: 'code' })).toEqual([]);
  });

  test('looks for an id, with or without its #, and only in the id', () => {
    expect(shownIds({ searchText: '#003' })).toEqual(['003']);
    expect(shownIds({ searchText: '10' })).toEqual(['010']);
  });

  test('shows only the visible tickets while nothing narrows the table, and every ticket once something does', () => {
    const visible = TICKETS.filter((ticket) => ticket.status !== 'abandoned');

    expect(shownIds({}, visible)).not.toContain('004');
    expect(shownIds({ typeChips: ['bug'] }, visible)).toContain('004');
    expect(shownIds({ searchText: 'plain words' }, visible)).toEqual(['004']);
  });
});

describe('the chip counts', () => {
  test('count what pressing each chip would add: the search and the other group apply, the chip\'s own group does not', () => {
    const view         = {
      ...DEFAULT_TICKET_VIEW, searchText: 'dark', typeChips: ['bug' as const], statusChips: ['pending' as const]
    };
    const statusCounts = TicketViewUtil.statusChipCountsOf(view, TICKETS, SEARCHABLE_TEXT_BY_ID);
    const typeCounts   = TicketViewUtil.typeChipCountsOf(view, TICKETS, SEARCHABLE_TEXT_BY_ID);

    expect(statusCounts.get('pending')).toBe(1);
    expect(statusCounts.get('reviewed')).toBe(1);
    expect(statusCounts.get('abandoned')).toBe(0);
    expect(typeCounts.get('bug')).toBe(1);
    expect(typeCounts.get('feature')).toBe(1);
    expect(typeCounts.get('change')).toBe(0);
  });

  test('count a ticket under each of its epics, and a ticket in none under the no-epic chip', () => {
    const epicCounts = TicketViewUtil.epicChipCountsOf({ ...DEFAULT_TICKET_VIEW, epicChips: ['theming'] }, TICKETS, SEARCHABLE_TEXT_BY_ID);

    expect(epicCounts.get('theming')).toBe(2);
    expect(epicCounts.get('checkout-redesign')).toBe(1);
    expect(epicCounts.get(NO_EPIC_CHIP)).toBe(3);
  });

  test('put a repeat review under the one Reviewing chip', () => {
    expect(TicketViewUtil.statusChipOf('re-review')).toBe('reviewing');
    expect(TicketViewUtil.statusChipOf('paused')).toBe('paused');
  });
});

describe('the sort', () => {
  test.each([
    ['id', 'ascending', ['001', '002', '003', '004', '010']],
    ['title', 'ascending', ['002', '010', '001', '004', '003']],
    ['type', 'descending', ['001', '003', '010', '004', '002']],
    ['status', 'ascending', ['002', '001', '010', '003', '004']],
    ['epic', 'ascending', ['002', '001', '010', '004', '003']],
    ['epic', 'descending', ['001', '002', '010', '004', '003']],
    ['branch', 'descending', ['002', '010', '004', '003', '001']],
  ] as const)('orders by %s %s, the newest first on a tie and an empty value last', (sortKey, sortDirection, expected) => {
    expect(shownIds({ sortKey, sortDirection })).toEqual([...expected]);
  });

  test('reverses the sorted column on a second press, and starts a new one ascending, or the id newest first', () => {
    const byTitle = TicketViewUtil.viewSortedBy(DEFAULT_TICKET_VIEW, 'title');

    expect(byTitle).toMatchObject({ sortKey: 'title', sortDirection: 'ascending' });
    expect(TicketViewUtil.viewSortedBy(byTitle, 'title')).toMatchObject({ sortKey: 'title', sortDirection: 'descending' });
    expect(TicketViewUtil.viewSortedBy(byTitle, 'id')).toMatchObject({ sortKey: 'id', sortDirection: 'descending' });
  });
});

describe('bodyPlainTextOf', () => {
  test('drops every tag with its attributes and reads the escaped characters back', () => {
    expect(TicketViewUtil.bodyPlainTextOf('<a href="#x" title="hidden">link</a> &lt;b&gt; &#39;q&#x27;')).toBe('link <b> \'q\'');
  });

  test('keeps the words of two blocks apart, and a phrase whole across an inline tag', () => {
    expect(TicketViewUtil.bodyPlainTextOf('<p>one</p><p>two <em>three</em>\nfour</p>')).toBe('one two three four');
  });
});
