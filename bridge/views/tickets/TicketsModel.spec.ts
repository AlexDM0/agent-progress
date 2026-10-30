/**
 * The Tickets view model, holding the cases of `page/tickets/`'s view and markup specs as model assertions: the search (title, branch,
 * group, epic, body text read back from its markup, an id query looking at the id alone), the chips (OR inside a group, AND across, counts
 * that ignore their own group, a repeat review under Reviewing), the sort and its ties, grouping by primary epic, the empty table's phrase
 * and the count line. The state and waiting-on come from the Board's facts, which the fixture sets apart from the stored status.
 */
import { describe, expect, test } from 'bun:test';

import { exampleTicketsBoard, exampleTicketsTicket } from '../../testing/TicketsBoardFixture.ts';
import type { MatchPiece }                           from '../../utils/SearchMatchUtil.ts';
import {
  DEFAULT_TICKET_VIEW,
  NO_EPIC_CHIP,
  TicketsModel,
  type TicketView
} from './TicketsModel.ts';

const BOARD = exampleTicketsBoard({
  tickets: [
    exampleTicketsTicket('001', { title: 'Add dark mode', branch: 'ticket-001', status: 'delivered' }),
    exampleTicketsTicket('002', {
      title: 'Fix the export', type: 'bug', group: 'export-work', epics: ['billing'], priority: 'high'
    }),
    exampleTicketsTicket('003', {
      title: 'Research a vendor', type: 'research', epics: ['checkout', 'billing'], priority: 'low', task: 7
    }),
    exampleTicketsTicket('012', { bodyHtml: '<p class="darkroom">Ships the <em>night</em> theme &amp; its toggle</p>', status: 'in-review' }),
  ],
  displayStates: { '012': 're-review' },
  waitingOn:     { '003': ['002'] },
  ownRows:       {
    '012': {
      id: 9, status: 're-review', note: '', reviewRound: 3
    },
  },
});

function shownIds(view: Partial<TicketView> = {}, groupedByEpic = false): string[] {
  return TicketsModel.ticketsModelOf(BOARD, { ...DEFAULT_TICKET_VIEW, ...view }, groupedByEpic).groups.flatMap((group) => group.rows.map((row) => row.ticketId));
}

function joined(pieces: readonly MatchPiece[]): string {
  return pieces.map((piece) => (piece.isMatch ? `[${piece.text}]` : piece.text)).join('');
}

describe('the search and the chips', () => {
  test('shows every ticket newest first by default', () => {
    expect(shownIds()).toEqual(['012', '003', '002', '001']);
  });

  test('searches the title, branch and group, whatever the case', () => {
    expect(shownIds({ searchText: 'DARK' })).toEqual(['001']);
    expect(shownIds({ searchText: 'ticket-001' })).toEqual(['001']);
    expect(shownIds({ searchText: 'export-WORK' })).toEqual(['002']);
  });

  test('finds a ticket by the key or the title of any of its epics', () => {
    expect(shownIds({ searchText: 'checkout' })).toEqual(['003']);
    expect(shownIds({ searchText: 'example billing' })).toEqual(['003', '002']);
  });

  test('finds a phrase only its body holds, the escaped characters read back, and never a word inside a tag', () => {
    expect(shownIds({ searchText: 'night theme & its' })).toEqual(['012']);
    expect(shownIds({ searchText: 'darkroom' })).toEqual([]);
  });

  test('looks for an id, with or without its #, and only in the id', () => {
    expect(shownIds({ searchText: '#12' })).toEqual(['012']);
    expect(shownIds({ searchText: '1' })).toEqual(['012', '001']);
  });

  test('combines the search with a chip as an AND, and the chips of one group as an OR', () => {
    expect(shownIds({ typeChips: ['bug', 'research'] })).toEqual(['003', '002']);
    expect(shownIds({ typeChips: ['bug', 'research'], searchText: 'vendor' })).toEqual(['003']);
  });

  test('keeps a ticket in any pressed epic, the tickets in none under the no-epic chip, and drops a chip naming no epic', () => {
    expect(shownIds({ epicChips: ['checkout'] })).toEqual(['003']);
    expect(shownIds({ epicChips: [NO_EPIC_CHIP] })).toEqual(['012', '001']);
    expect(shownIds({ epicChips: ['retired-epic'] })).toEqual(['012', '003', '002', '001']);
  });

  test('a repeat review answers to the one Reviewing chip, by the Board\'s display state', () => {
    expect(shownIds({ statusChips: ['reviewing'] })).toEqual(['012']);
    expect(shownIds({ statusChips: ['in-review'] })).toEqual([]);
  });

  test('a chip counts what pressing it would show: the search and the other groups apply, its own group does not', () => {
    const model = TicketsModel.ticketsModelOf(BOARD, { ...DEFAULT_TICKET_VIEW, typeChips: ['bug'], epicChips: ['billing'] }, false);
    expect(Object.fromEntries(model.countByChip.type)).toEqual({ ticket: 0, bug: 1, research: 1 });
    expect(Object.fromEntries(model.countByChip.epic)).toEqual({ billing: 1 });
    expect(model.countByChip.status.get('pending')).toBe(1);
  });
});

describe('the sort', () => {
  test('a second press reverses the column; a new column starts ascending, the id newest first', () => {
    const byTitle = TicketsModel.viewSortedBy(DEFAULT_TICKET_VIEW, 'title');
    expect([byTitle.sortKey, byTitle.sortDirection]).toEqual(['title', 'ascending']);
    expect(TicketsModel.viewSortedBy(byTitle, 'title').sortDirection).toBe('descending');
    expect(TicketsModel.viewSortedBy(byTitle, 'id').sortDirection).toBe('descending');
  });

  test('a ticket in no epic or on no branch sorts last whichever way, and ties fall back to newest first', () => {
    expect(shownIds({ sortKey: 'epic', sortDirection: 'ascending' })).toEqual(['002', '003', '012', '001']);
    expect(shownIds({ sortKey: 'epic', sortDirection: 'descending' })).toEqual(['003', '002', '012', '001']);
    expect(shownIds({ sortKey: 'branch', sortDirection: 'descending' })).toEqual(['001', '012', '003', '002']);
  });
});

describe('the rows', () => {
  test('a row carries its id, Board state label with its round, priority, type, waiting-on, epics and task', () => {
    const rows = TicketsModel.ticketsModelOf(BOARD, DEFAULT_TICKET_VIEW, false).groups[0]?.rows ?? [];
    const [review, research] = rows;
    expect([review?.idText, review?.stateToken, review?.stateLabel, review?.priority, review?.taskText]).toEqual(['#012', 're-review', 'Reviewing (round 3)', null, null]);
    expect([research?.priority, research?.ticketType, research?.waitingOn, research?.epics.map((epic) => epic.key), research?.taskText])
      .toEqual(['low', 'research', ['#002'], ['checkout', 'billing'], '#7']);
    expect(rows[2]?.priority).toBe('high');
  });

  test('marks the search in the title, the group and the branch, but not an id query', () => {
    const model = TicketsModel.ticketsModelOf(BOARD, { ...DEFAULT_TICKET_VIEW, searchText: 'EXPORT' }, false);
    const [row] = model.groups[0]?.rows ?? [];
    expect([joined(row?.titlePieces ?? []), joined(row?.groupPieces ?? [])]).toEqual(['Fix the [export]', '[export]-work']);
    const idQuery = TicketsModel.ticketsModelOf(BOARD, { ...DEFAULT_TICKET_VIEW, searchText: '001' }, false);
    expect(idQuery.groups[0]?.rows[0]?.branchPieces).toEqual([{ text: 'ticket-001', isMatch: false }]);
  });

  test('grouped, each epic\'s tickets follow its head, a ticket under its primary epic only, then the tickets in none', () => {
    const model = TicketsModel.ticketsModelOf(BOARD, DEFAULT_TICKET_VIEW, true);
    expect(model.groups.map((group) => [group.key, group.showsHead, group.rows.map((row) => row.ticketId)])).toEqual([
      ['billing', true, ['002']],
      ['checkout', true, ['003']],
      [NO_EPIC_CHIP, true, ['012', '001']],
    ]);
  });

  test('a board without epics stays flat, offering no epic chip', () => {
    const board = exampleTicketsBoard({ tickets: [exampleTicketsTicket('001')], withoutEpics: true });
    const model = TicketsModel.ticketsModelOf(board, DEFAULT_TICKET_VIEW, true);
    expect([model.showsEpics, model.epicChips, model.groups.map((group) => group.showsHead)]).toEqual([false, [], [false]]);
  });
});

describe('the empty table and the count', () => {
  test('says what was asked, a pressed epic by its title and the no-epic chip as itself', () => {
    const model = TicketsModel.ticketsModelOf(BOARD, {
      ...DEFAULT_TICKET_VIEW, searchText: ' nothing ', statusChips: ['paused'], typeChips: ['bug'], epicChips: ['checkout', NO_EPIC_CHIP]
    }, false);
    expect([model.emptyText, model.narrows]).toEqual(['No ticket matches “nothing”, status Paused, type bug, epic Example checkout or no epic.', true]);
  });

  test('a board without tickets says so in the count and shows no empty row', () => {
    const model = TicketsModel.ticketsModelOf(exampleTicketsBoard({ tickets: [] }), DEFAULT_TICKET_VIEW, false);
    expect([model.countText, model.emptyText]).toEqual(['no tickets', null]);
  });

  test('counts the shown against all, and the tickets in progress', () => {
    const board = exampleTicketsBoard({ tickets: [exampleTicketsTicket('001', { status: 'in-progress' }), exampleTicketsTicket('002')] });
    expect(TicketsModel.ticketsModelOf(board, { ...DEFAULT_TICKET_VIEW, searchText: '#2' }, false).countText).toBe('1 of 2 tickets · 1 in progress');
  });
});

describe('ticketsBoardStateOf', () => {
  test('reads a state document carrying the page payload, and nothing short of it', () => {
    expect(TicketsModel.ticketsBoardStateOf(BOARD)).toBe(BOARD);
    expect(TicketsModel.ticketsBoardStateOf({ page: { tickets: [], payload: {} } })).toBeNull();
    expect(TicketsModel.ticketsBoardStateOf(null)).toBeNull();
  });
});
