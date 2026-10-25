/**
 * The finished-work choice's rules. The cases that matter: on one constructed board with work finished 30 minutes, 5 hours, 10 hours,
 * 2 days and 5 days ago, every choice lets through exactly the finished items it reaches and never hides unfinished work; a picked day
 * starts at its local midnight; a ticket is dated by its closing stamp, an epic by its span's end once every ticket is settled; stored
 * and clicked values read back only as real choices; and the filter line names every window, a stored one the menu no longer offers
 * included, and reads as showing all once nothing is hidden. Abandoned work, stampless
 * included, hides beside delivered work of the same age in Progress, Tickets, Kanban and Epics, never shown forever for a missing stamp.
 */

import { describe, expect, test }  from 'bun:test';
import type { Task, TaskPhase }    from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }       from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';
import type { FinishedWorkChoice } from '../@types/ViewerChoices.ts';
import { KanbanLaneUtil }          from '../kanban/utils/KanbanLaneUtil.ts';
import { pageBoardFixture }        from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }     from '../testing/PageLimitsFixture.ts';
import { FinishedWorkUtil }        from './FinishedWorkUtil.ts';

const {
  boardFinishedMomentsOf,
  shownEpicsOf,
  choiceFrom,
  cutoffEpochMillisecondsOf,
  epicFinishedEpochMillisecondsOf,
  filterLineTextOf,
  finishedMomentIsShown,
  hiddenCountOf,
  labelOf,
  shownFinishedCountOf,
  sinceChoiceFor,
  taskFinishedEpochMillisecondsOf,
  ticketFinishedEpochMillisecondsOf,
  windowPhraseOf,
} = FinishedWorkUtil;

const MINUTE_MILLISECONDS    = 60_000;
const HOUR_MILLISECONDS      = 60 * MINUTE_MILLISECONDS;
const DAY_MILLISECONDS       = 24 * HOUR_MILLISECONDS;
const NOW_EPOCH_MILLISECONDS = new Date(2026, 8, 25, 13, 36).getTime();

const NO_TICKET_COUNTS: Record<TicketStatus, number> = {
  'pending': 0, 'in-progress': 0, 'in-review': 0, 'reviewed': 0, 'delivered': 0, 'abandoned': 0,
};

function stampBefore(milliseconds: number): string {
  return new Date(NOW_EPOCH_MILLISECONDS - milliseconds).toISOString();
}

function exampleTask(id: number, changes: Partial<Task>): Task {
  return {
    id,
    name:   `Example task ${id}`,
    status: 'delivered',
    start:  stampBefore(10 * DAY_MILLISECONDS),
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(id: string, changes: Partial<PageTicket>): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'delivered',
    filed:       stampBefore(10 * DAY_MILLISECONDS),
    updated:     stampBefore(10 * DAY_MILLISECONDS),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `.agent-progress/tickets/${id}-example.md`,
    bodyHtml:    '',
    ...changes,
  };
}

/** Finished 30 minutes, 5 hours, 10 hours, 2 days and 5 days ago, then two rows still open, one of them started 9 days ago. */
const BOARD_TASKS: readonly Task[] = [
  exampleTask(1, { end: stampBefore(30 * MINUTE_MILLISECONDS) }),
  exampleTask(2, { end: stampBefore(5 * HOUR_MILLISECONDS), status: 'abandoned' }),
  exampleTask(3, { end: stampBefore(10 * HOUR_MILLISECONDS) }),
  exampleTask(4, { end: stampBefore(2 * DAY_MILLISECONDS) }),
  exampleTask(5, { end: stampBefore(5 * DAY_MILLISECONDS) }),
  exampleTask(6, { status: 'in-progress', start: stampBefore(9 * DAY_MILLISECONDS) }),
  exampleTask(7, { status: 'reviewed', end: stampBefore(9 * DAY_MILLISECONDS) }),
];

const BOARD_TICKETS: readonly PageTicket[] = [
  exampleTicket('001', { delivered: stampBefore(30 * MINUTE_MILLISECONDS) }),
  exampleTicket('002', { status: 'abandoned', abandonedAt: stampBefore(5 * HOUR_MILLISECONDS) }),
  exampleTicket('003', { delivered: stampBefore(10 * HOUR_MILLISECONDS) }),
  exampleTicket('004', { delivered: stampBefore(2 * DAY_MILLISECONDS) }),
  exampleTicket('005', { delivered: stampBefore(5 * DAY_MILLISECONDS) }),
  exampleTicket('006', { status: 'pending' }),
  exampleTicket('007', { status: 'in-review' }),
];

function shownTaskIds(choice: FinishedWorkChoice): number[] {
  const cutoff = cutoffEpochMillisecondsOf(choice, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
  return BOARD_TASKS.filter((task) => finishedMomentIsShown(taskFinishedEpochMillisecondsOf(task), cutoff)).map((task) => task.id);
}

function shownTicketIds(choice: FinishedWorkChoice): string[] {
  const cutoff = cutoffEpochMillisecondsOf(choice, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
  return BOARD_TICKETS.filter((ticket) => finishedMomentIsShown(ticketFinishedEpochMillisecondsOf(ticket), cutoff)).map((ticket) => ticket.id);
}

/** The local calendar day `daysBack` days before the board's now. */
function calendarDateBefore(daysBack: number): string {
  const day = new Date(NOW_EPOCH_MILLISECONDS - daysBack * DAY_MILLISECONDS);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

describe('each choice on the constructed board', () => {
  const EXPECTED_SHOWN: readonly (readonly [FinishedWorkChoice, number[], string[]])[] = [
    ['1h', [1, 6, 7], ['001', '006', '007']],
    ['6h', [1, 2, 6, 7], ['001', '002', '006', '007']],
    ['12h', [1, 2, 3, 6, 7], ['001', '002', '003', '006', '007']],
    ['1d', [1, 2, 3, 6, 7], ['001', '002', '003', '006', '007']],
    ['3d', [1, 2, 3, 4, 6, 7], ['001', '002', '003', '004', '006', '007']],
    ['all', [1, 2, 3, 4, 5, 6, 7], ['001', '002', '003', '004', '005', '006', '007']],
  ];

  for (const [choice, taskIds, ticketIds] of EXPECTED_SHOWN) {
    test(`${choice} shows exactly the finished work it reaches and every unfinished item`, () => {
      expect(shownTaskIds(choice)).toEqual(taskIds);
      expect(shownTicketIds(choice)).toEqual(ticketIds);
    });
  }

  test('a day picked 3 days back shows what finished since that local midnight: 2 days ago, not 5', () => {
    const choice = sinceChoiceFor(calendarDateBefore(3));
    expect(choice).not.toBeNull();
    expect(shownTaskIds(choice ?? 'all')).toEqual([1, 2, 3, 4, 6, 7]);
    expect(shownTicketIds(choice ?? 'all')).toEqual(['001', '002', '003', '004', '006', '007']);
  });

  test('a picked day starts at its local midnight', () => {
    const calendarDate = calendarDateBefore(1);
    const [year, month, day] = calendarDate.split('-').map(Number);
    expect(cutoffEpochMillisecondsOf(`since-${calendarDate}`, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS))
      .toBe(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getTime());
  });

  test('counts what a choice lets through and what it hides, never counting open work as either', () => {
    const moments = BOARD_TASKS.map((task) => taskFinishedEpochMillisecondsOf(task));
    const cutoff  = cutoffEpochMillisecondsOf('6h', NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
    expect(shownFinishedCountOf(moments, cutoff)).toBe(2);
    expect(hiddenCountOf(moments, cutoff)).toBe(3);
  });
});

describe('finished moments', () => {
  test('a settled row without an end finished when it started, and an open row has no finished moment', () => {
    expect(taskFinishedEpochMillisecondsOf(exampleTask(1, { start: stampBefore(HOUR_MILLISECONDS) }))).toBe(NOW_EPOCH_MILLISECONDS - HOUR_MILLISECONDS);
    expect(taskFinishedEpochMillisecondsOf(exampleTask(1, { status: 'reviewed', end: stampBefore(HOUR_MILLISECONDS) }))).toBeNull();
  });

  test('a ticket is dated by its closing stamp, and by its last transition when it has none', () => {
    expect(ticketFinishedEpochMillisecondsOf(exampleTicket('001', { delivered: stampBefore(HOUR_MILLISECONDS) }))).toBe(NOW_EPOCH_MILLISECONDS - HOUR_MILLISECONDS);
    expect(ticketFinishedEpochMillisecondsOf(exampleTicket('001', { updated: stampBefore(DAY_MILLISECONDS) }))).toBe(NOW_EPOCH_MILLISECONDS - DAY_MILLISECONDS);
  });

  test('an epic finishes when its span ends with every ticket settled, and an open or empty one has no finished moment', () => {
    const settledCounts = { ...NO_TICKET_COUNTS, delivered: 2, abandoned: 1 };
    const span          = { start: stampBefore(3 * DAY_MILLISECONDS), end: stampBefore(2 * DAY_MILLISECONDS) };
    const noMoments     = new Map<string, number | null>();
    expect(epicFinishedEpochMillisecondsOf({ ticketCountByStatus: settledCounts, span, ticketIds: [] }, noMoments)).toBe(NOW_EPOCH_MILLISECONDS - 2 * DAY_MILLISECONDS);
    expect(epicFinishedEpochMillisecondsOf({ ticketCountByStatus: { ...settledCounts, 'in-review': 1 }, span, ticketIds: [] }, noMoments)).toBeNull();
    expect(epicFinishedEpochMillisecondsOf({ ticketCountByStatus: NO_TICKET_COUNTS, span: null, ticketIds: [] }, noMoments)).toBeNull();
  });

  test('a settled epic without a span end ended when its last ticket closed', () => {
    const settledCounts = { ...NO_TICKET_COUNTS, abandoned: 2 };
    const moments       = new Map([['001', NOW_EPOCH_MILLISECONDS - 3 * DAY_MILLISECONDS], ['002', NOW_EPOCH_MILLISECONDS - 2 * DAY_MILLISECONDS]]);
    expect(epicFinishedEpochMillisecondsOf({ ticketCountByStatus: settledCounts, span: null, ticketIds: ['001', '002'] }, moments))
      .toBe(NOW_EPOCH_MILLISECONDS - 2 * DAY_MILLISECONDS);
  });

  test('finished work the page cannot date stays shown', () => {
    expect(finishedMomentIsShown(null, NOW_EPOCH_MILLISECONDS)).toBe(true);
  });
});

describe('choiceFrom', () => {
  test('reads every span and a real day, and nothing else', () => {
    expect(choiceFrom('1h')).toBe('1h');
    expect(choiceFrom('all')).toBe('all');
    expect(choiceFrom('since-2026-09-24')).toBe('since-2026-09-24');
    expect(choiceFrom('since-2026-02-30')).toBeNull();
    expect(choiceFrom('since-yesterday')).toBeNull();
    expect(choiceFrom('recent')).toBeNull();
    expect(choiceFrom('constructor')).toBeNull();
    expect(choiceFrom(42)).toBeNull();
  });
});

describe('the words', () => {
  test('a choice reads as its pill and as the end of "finished …"', () => {
    expect(labelOf('1h')).toBe('last hour');
    expect(labelOf('12h')).toBe('12 hours');
    expect(labelOf('since-2026-09-24')).toBe('since 09-24');
    expect(windowPhraseOf('1d')).toBe('in the last day');
    expect(windowPhraseOf('3d')).toBe('in the last 3 days');
    expect(windowPhraseOf('all')).toBe('ever');
    expect(windowPhraseOf('since-2026-09-24')).toBe('since 09-24');
  });
});

describe('filterLineTextOf', () => {
  test('names the window of a span, the day of a since choice, and a stored 6 or 12 hours the menu no longer offers', () => {
    expect(filterLineTextOf('1h', 3)).toEqual({ lead: 'Hiding closed > ', window: '1 hour' });
    expect(filterLineTextOf('1d', 3)).toEqual({ lead: 'Hiding closed > ', window: '1 day' });
    expect(filterLineTextOf('3d', 3)).toEqual({ lead: 'Hiding closed > ', window: '3 days' });
    expect(filterLineTextOf('6h', 3)).toEqual({ lead: 'Hiding closed > ', window: '6 hours' });
    expect(filterLineTextOf('12h', 3)).toEqual({ lead: 'Hiding closed > ', window: '12 hours' });
    expect(filterLineTextOf('since-2026-09-24', 3)).toEqual({ lead: 'Hiding closed before ', window: '09-24' });
  });

  test('reads as showing all once nothing is hidden, whatever the window', () => {
    expect(filterLineTextOf('all', 0)).toEqual({ lead: 'Showing all closed', window: '' });
    expect(filterLineTextOf('1d', 0)).toEqual({ lead: 'Showing all closed', window: '' });
  });
});

describe('abandoned work ages exactly as delivered work in every view the switch feeds', () => {
  const TWO_DAYS_AGO = stampBefore(2 * DAY_MILLISECONDS);
  const AN_HOUR_AGO  = stampBefore(HOUR_MILLISECONDS);
  const historyEndingAt = (status: 'delivered' | 'abandoned', at: string): TaskPhase[] => [{ status: 'pending', at: stampBefore(3 * DAY_MILLISECONDS) }, { status, at }];

  // Pairs side by side: stamped two days ago, stamped an hour ago, and stampless with a two-day-old last move.
  const board = pageBoardFixture({
    tasks: [
      exampleTask(1, { status: 'delivered', end: TWO_DAYS_AGO, ticket: '010' }),
      exampleTask(2, { status: 'abandoned', end: TWO_DAYS_AGO, ticket: '011' }),
      exampleTask(3, { status: 'delivered', end: AN_HOUR_AGO, ticket: '012' }),
      exampleTask(4, { status: 'abandoned', end: AN_HOUR_AGO, ticket: '013' }),
      exampleTask(5, {
        status: 'delivered', start: null, history: historyEndingAt('delivered', TWO_DAYS_AGO), ticket: '014'
      }),
      exampleTask(6, {
        status: 'abandoned', start: null, history: historyEndingAt('abandoned', TWO_DAYS_AGO), ticket: '015'
      }),
      exampleTask(7, { status: 'delivered', start: null, ticket: '016' }),
      exampleTask(8, { status: 'abandoned', start: null, ticket: '017' }),
    ],
    tickets: [
      exampleTicket('010', {
        status: 'delivered', delivered: TWO_DAYS_AGO, task: 1, epics: ['old-delivered']
      }),
      exampleTicket('011', {
        status: 'abandoned', abandonedAt: TWO_DAYS_AGO, task: 2, epics: ['old-abandoned']
      }),
      exampleTicket('012', {
        status: 'delivered', delivered: AN_HOUR_AGO, task: 3, epics: ['new-delivered']
      }),
      exampleTicket('013', {
        status: 'abandoned', abandonedAt: AN_HOUR_AGO, task: 4, epics: ['new-abandoned']
      }),
      exampleTicket('014', {
        status: 'delivered', updated: TWO_DAYS_AGO, task: 5, epics: ['unstamped-delivered']
      }),
      exampleTicket('015', {
        status: 'abandoned', updated: TWO_DAYS_AGO, task: 6, epics: ['unstamped-abandoned']
      }),
      exampleTicket('016', { status: 'delivered', updated: TWO_DAYS_AGO, task: 7 }),
      exampleTicket('017', { status: 'abandoned', updated: TWO_DAYS_AGO, task: 8 }),
    ],
    epics: ['old-delivered', 'old-abandoned', 'new-delivered', 'new-abandoned', 'unstamped-delivered', 'unstamped-abandoned']
      .map((key, index) => ({
        key, title: key, slot: index + 1, extra: []
      })),
  });
  const moments = boardFinishedMomentsOf(board);
  const cutoff  = cutoffEpochMillisecondsOf('1d', NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
  const shownTicketsOfBoard = board.tickets.filter((_ticket, index) => finishedMomentIsShown(moments.tickets[index] ?? null, cutoff));

  test('Progress: under the last day, only the rows finished an hour ago show, stampless abandoned rows aged as stampless done ones', () => {
    expect(board.rows.filter((_row, index) => finishedMomentIsShown(moments.tasks[index] ?? null, cutoff)).map((row) => row.id)).toEqual([3, 4]);
  });

  test('Tickets: under the last day, only the pair finished an hour ago shows, an abandoned ticket without abandonedAt aged by updated', () => {
    expect(shownTicketsOfBoard.map((ticket) => ticket.id)).toEqual(['012', '013']);
  });

  test('Kanban: the done and abandoned lanes each keep only the ticket finished an hour ago', () => {
    const cards = KanbanLaneUtil.kanbanCardsFor(shownTicketsOfBoard, new Map());
    expect(cards.filter((card) => KanbanLaneUtil.laneOfState(card.state) === 'done').map((card) => card.ticket.id)).toEqual(['012']);
    expect(cards.filter((card) => KanbanLaneUtil.laneOfState(card.state) === 'abandoned').map((card) => card.ticket.id)).toEqual(['013']);
  });

  test('Epics: an all-abandoned epic hides as an all-delivered one does, one whose rows never started dated by its tickets', () => {
    expect(shownEpicsOf(board.epics, moments.ticketFinishedMomentById, cutoff).map((epic) => epic.key)).toEqual(['new-delivered', 'new-abandoned']);
  });
});
