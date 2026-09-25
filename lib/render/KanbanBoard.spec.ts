/**
 * The Kanban rules callers rely on: a card sits in the lane its row's Progress pill names, the open lanes read by priority and the closed ones
 * newest first, each sub-state note appears only where its source exists, the lane heads count independently, and the closed lanes open
 * 15, then 25 at a time, clamped whatever storage says.
 */

import { describe, expect, test } from 'bun:test';
import type {
  Task,
  TaskStatus,
  TicketPriority,
  TicketStatus,
} from '../constants/Types.ts';
import type { KanbanCard, KanbanLane, NoteFormat } from './page/KanbanBoard.ts';
import {
  abandonedLaneChoiceFor,
  abandonedLaneIsOpenFrom,
  abandonedLaneStorageKeyFor,
  cappedLaneShownCount,
  cappedLaneStorageKeyFor,
  cardsInLane,
  DEFAULT_ABANDONED_LANE_CHOICE,
  kanbanCardsFor,
  laneIsDividedByPriority,
  laneOfState,
  laneSubCountsOf,
  nextPageSizeFor,
  overflowDirectionsOf,
  shownCountAfterMore,
  shownCountFrom,
  subStateNoteOf,
} from './page/KanbanBoard.ts';
import type { PageTicket } from './page/PageData.ts';
import type { RowState }   from './page/PageMarkup.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_SLICES = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'feature',
    status:      'open',
    filed:       at('08:00'),
    updated:     at('08:00'),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '',
    ...changes,
  };
}

function exampleRow(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example row ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function cardOf(ticket: PageTicket, tasks: readonly Task[], waitingOn: readonly string[] = []): KanbanCard {
  const [card] = kanbanCardsFor([ticket], tasks, new Map([[ticket.id, waitingOn]]));
  if (card === undefined) {
    throw new Error('no card was built');
  }
  return card;
}

function noteFormat(tasks: readonly Task[]): NoteFormat {
  return {
    tasks,
    nowEpochMilliseconds: EXAMPLE_NOW,
    todayCalendarDate:    EXAMPLE_TODAY,
    slices:               EXAMPLE_SLICES,
  };
}

describe('which lane a card sits in', () => {
  // Every row state the Progress tab can show, so a card can never land in a lane whose pill disagrees with the chart.
  test.each([
    ['pending', 'open', 'todo'],
    ['running', 'in-progress', 'progress'],
    ['paused', 'in-progress', 'progress'],
    ['finished', 'open', 'review'],
    ['finished', 'in-review', 'review'],
    ['re-review', 'in-review', 'review'],
    ['reviewed', 'done', 'merge'],
    ['delivered', 'delivered', 'done'],
    ['abandoned', 'abandoned', 'abandoned'],
  ] as Array<[TaskStatus, TicketStatus, KanbanLane]>)('puts a %s row of a %s ticket in %s', (rowStatus, ticketStatus, lane) => {
    const card = cardOf(exampleTicket('007', { status: ticketStatus }), [exampleRow(1, { status: rowStatus, ticket: '007' })]);

    expect(laneOfState(card.state)).toBe(lane);
  });

  test('reads a finished row of an in-review ticket as reviewing, the pill the Progress tab shows', () => {
    expect(cardOf(exampleTicket('007', { status: 'in-review' }), [exampleRow(1, { status: 'finished', ticket: '007' })]).state).toBe('reviewing');
  });

  // A low ticket never started has no row; its status alone decides the lane.
  test.each([
    ['open', 'pending', 'todo'],
    ['in-progress', 'running', 'progress'],
    ['in-review', 'reviewing', 'review'],
    ['done', 'reviewed', 'merge'],
    ['delivered', 'delivered', 'done'],
    ['abandoned', 'abandoned', 'abandoned'],
  ] as Array<[TicketStatus, RowState, KanbanLane]>)('puts a %s ticket with no row in state %s and lane %s', (ticketStatus, state, lane) => {
    const card = cardOf(exampleTicket('007', { status: ticketStatus }), []);

    expect(card.ownRow).toBeNull();
    expect(card.state).toBe(state);
    expect(laneOfState(card.state)).toBe(lane);
  });

  test('never takes a review row as the ticket’s own row', () => {
    const reviewRow = exampleRow(2, { status: 'running', reviewOf: '007' });

    expect(cardOf(exampleTicket('007'), [reviewRow]).ownRow).toBeNull();
  });
});

describe('the order within a lane', () => {
  function idsInLane(tickets: readonly PageTicket[], lane: Parameters<typeof cardsInLane>[1]): string[] {
    return cardsInLane(kanbanCardsFor(tickets, [], new Map()), lane).map((card) => card.ticket.id);
  }

  test('runs high, normal, low, then the id as a number, so #9 comes before #10', () => {
    const tickets = [
      exampleTicket('10'),
      exampleTicket('9'),
      exampleTicket('3', { priority: 'low' }),
      exampleTicket('12', { priority: 'high' }),
    ];

    expect(idsInLane(tickets, 'todo')).toEqual(['12', '9', '10', '3']);
  });

  test('divides an open lane only when it holds more than one priority', () => {
    const cardsOfPriorities = (priorities: TicketPriority[]): KanbanCard[] => kanbanCardsFor(
      priorities.map((priority, index) => exampleTicket(String(index + 1), { priority })),
      [],
      new Map(),
    );

    expect(laneIsDividedByPriority('todo', cardsOfPriorities(['normal', 'normal']))).toBe(false);
    expect(laneIsDividedByPriority('todo', cardsOfPriorities(['normal', 'low']))).toBe(true);
    expect(laneIsDividedByPriority('done', cardsOfPriorities(['normal', 'low']))).toBe(false);
  });

  test('puts Done newest first by its delivered stamp, a tie to the higher id', () => {
    const tickets = [
      exampleTicket('004', { status: 'delivered', delivered: at('09:00') }),
      exampleTicket('005', { status: 'delivered', delivered: at('11:00') }),
      exampleTicket('006', { status: 'delivered', delivered: at('09:00') }),
      exampleTicket('003', { status: 'delivered', delivered: at('23:00', '2026-09-24') }),
    ];

    expect(idsInLane(tickets, 'done')).toEqual(['005', '006', '004', '003']);
  });

  test('puts Abandoned newest first by its abandoned stamp, a tie to the higher id', () => {
    const tickets = [
      exampleTicket('004', { status: 'abandoned', abandonedAt: at('09:00') }),
      exampleTicket('002', { status: 'abandoned', abandonedAt: at('10:00') }),
      exampleTicket('008', { status: 'abandoned', abandonedAt: at('09:00') }),
    ];

    expect(idsInLane(tickets, 'abandoned')).toEqual(['002', '008', '004']);
  });
});

describe('the sub-state note', () => {
  test('dates a pause from the newest paused phase and counts to now', () => {
    const row = exampleRow(1, {
      status:  'paused',
      ticket:  '061',
      history: [{ status: 'paused', at: at('09:00') }, { status: 'running', at: at('09:30') }, { status: 'paused', at: at('11:45') }],
    });

    expect(subStateNoteOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [row]), noteFormat([row]))).toBe('paused since 11:45 · 1h 51m');
  });

  test('leaves a paused row without history with no note', () => {
    const row = exampleRow(1, { status: 'paused', ticket: '061' });

    expect(subStateNoteOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [row]), noteFormat([row]))).toBeNull();
  });

  test.each([
    ['the newest finished phase', { history: [{ status: 'finished', at: at('13:20') }] }, { finished: at('12:00') }, 'no reviewer yet · 16m'],
    ['the ticket’s finished stamp', {}, { finished: at('13:00') }, 'no reviewer yet · 36m'],
    ['the row’s end', { end: at('11:36') }, {}, 'no reviewer yet · 2h'],
  ] as Array<[string, Partial<Task>, Partial<PageTicket>, string]>)('counts the wait for a reviewer from %s', (_source, rowChanges, ticketChanges, expected) => {
    const row = exampleRow(1, { status: 'finished', ticket: '062', ...rowChanges });

    expect(subStateNoteOf(cardOf(exampleTicket('062', { status: 'open', ...ticketChanges }), [row]), noteFormat([row]))).toBe(expected);
  });

  test('names the running reviewer’s start on a reviewing card', () => {
    const tasks = [exampleRow(1, { status: 'finished', ticket: '058' }), exampleRow(2, { status: 'running', reviewOf: '058', start: at('13:05') })];

    expect(subStateNoteOf(cardOf(exampleTicket('058', { status: 'in-review' }), tasks), noteFormat(tasks))).toBe('reviewer since 13:05');
  });

  test('names the round and the newest reviewer on a repeat review, finding a review row by its name', () => {
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059', reviewRound: 3 }),
      exampleRow(2, {
        name: 'Review 1 #059 — Accent-blind search', status: 'delivered', start: at('10:50'), end: at('11:30') 
      }),
      exampleRow(3, { name: 'Review 2 #059 — Accent-blind search', status: 'running', start: at('11:34', '2026-09-24') }),
    ];

    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks), noteFormat(tasks))).toBe('round 3 reviewer since 09-24 11:34');
  });

  test('falls back to the first repeat round when the row names none', () => {
    const tasks = [exampleRow(1, { status: 're-review', ticket: '059' }), exampleRow(2, { reviewOf: '059', status: 'running', start: at('11:34') })];

    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks), noteFormat(tasks))).toBe('round 2 reviewer since 11:34');
  });

  // Between rounds the newest review has ended and no new one has started: no reviewer is running, so none is named.
  test('leaves a reviewing card with no note when the newest review row has ended', () => {
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059' }),
      exampleRow(2, { reviewOf: '059', status: 'running', start: at('10:50') }),
      exampleRow(3, {
        reviewOf: '059', status: 'delivered', start: at('11:00'), end: at('11:30') 
      }),
    ];

    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks), noteFormat(tasks))).toBeNull();
  });

  test('says when an awaiting-merge card was reviewed, and nothing when the row does not know', () => {
    const reviewed   = exampleRow(1, { status: 'reviewed', ticket: '056', reviewed: at('12:10') });
    const unrecorded = exampleRow(2, { status: 'reviewed', ticket: '057' });

    expect(subStateNoteOf(cardOf(exampleTicket('056', { status: 'done' }), [reviewed]), noteFormat([reviewed]))).toBe('reviewed 12:10');
    expect(subStateNoteOf(cardOf(exampleTicket('057', { status: 'done' }), [unrecorded]), noteFormat([unrecorded]))).toBeNull();
  });

  test('gives an abandoned card its reason, and no note without one', () => {
    expect(subStateNoteOf(cardOf(exampleTicket('046', { status: 'abandoned', reason: 'Superseded by #056' }), []), noteFormat([]))).toBe('Superseded by #056');
    expect(subStateNoteOf(cardOf(exampleTicket('047', { status: 'abandoned' }), []), noteFormat([]))).toBeNull();
  });
});

describe('the lane heads', () => {
  test('counts To do’s waiting, held and rowless tickets independently, so a held ticket without a row counts twice', () => {
    const cards = [
      cardOf(exampleTicket('065'), [exampleRow(1, { ticket: '065' })], ['060']),
      cardOf(exampleTicket('068', { priority: 'low', hold: 'Waiting for copy' }), []),
      cardOf(exampleTicket('069', { priority: 'low' }), []),
    ];

    expect(laneSubCountsOf('todo', cards).map((entry) => `${entry.count} ${entry.label}`)).toEqual(['1 waiting', '1 held', '2 no row']);
  });

  test('leaves a zero count out and counts a repeat review as reviewing', () => {
    const tasks = [exampleRow(1, { status: 're-review', ticket: '059' }), exampleRow(2, { status: 'finished', ticket: '058' })];
    const cards = kanbanCardsFor([exampleTicket('059', { status: 'in-review' }), exampleTicket('058', { status: 'in-review' })], tasks, new Map());

    expect(laneSubCountsOf('review', cards).map((entry) => `${entry.dotState} ${entry.count} ${entry.label}`)).toEqual(['reviewing 2 reviewing']);
  });

  test('counts every reviewed Done card, before the cap', () => {
    const tickets = Array.from({ length: 20 }, (_unused, index) => exampleTicket(String(index + 1), { status: 'delivered', delivered: at('10:00') }));
    const tasks   = tickets.map((ticket, index) => exampleRow(index + 1, { status: 'delivered', ticket: ticket.id }));

    expect(laneSubCountsOf('done', kanbanCardsFor(tickets, tasks, new Map()))).toEqual([{
      count:        20,
      label:        'reviewed first',
      dotState:     null,
      reviewedMark: true,
    }]);
  });
});

describe('the capped lanes', () => {
  const LANE_COUNT = 52;

  test('open 15, then 40 after one step, then all 52 after the remaining 12', () => {
    const first = cappedLaneShownCount(shownCountFrom(null), LANE_COUNT);
    const second = shownCountAfterMore(first, LANE_COUNT);

    expect(first).toBe(15);
    expect(nextPageSizeFor(first, LANE_COUNT)).toBe(25);
    expect(second).toBe(40);
    expect(nextPageSizeFor(second, LANE_COUNT)).toBe(12);
    expect(shownCountAfterMore(second, LANE_COUNT)).toBe(52);
    expect(nextPageSizeFor(52, LANE_COUNT)).toBe(0);
  });

  test.each([
    ['a count above the lane', '80', 52],
    ['a count below the first page', '3', 15],
    ['text that is no number', 'many', 15],
    ['a fraction', '20.5', 15],
  ])('clamps %s to the first page … the lane’s count', (_description, stored, expected) => {
    expect(cappedLaneShownCount(shownCountFrom(stored), LANE_COUNT)).toBe(expected);
  });

  test('keeps a key per tracker and lane, and the Abandoned lane closed unless storage says open', () => {
    expect(cappedLaneStorageKeyFor('tracker-a', 'done')).toBe('agent-progress:tracker-a:kanban-done-shown');
    expect(cappedLaneStorageKeyFor('tracker-a', 'abandoned')).toBe('agent-progress:tracker-a:kanban-abandoned-shown');
    expect(abandonedLaneStorageKeyFor('tracker-a')).toBe('agent-progress:tracker-a:kanban-abandoned');
    expect(abandonedLaneIsOpenFrom(null)).toBe(false);
    expect(abandonedLaneIsOpenFrom('open')).toBe(true);
    expect(abandonedLaneChoiceFor(false)).toBe(DEFAULT_ABANDONED_LANE_CHOICE);
    expect(abandonedLaneChoiceFor(true)).toBe('open');
  });
});

describe('overflowDirectionsOf', () => {
  test.each([
    ['fits', 0, 1000, 1000, null],
    ['at the start of a wider board', 0, 1400, 1000, 'end'],
    ['mid-scroll', 200, 1400, 1000, 'start end'],
    ['at the end', 400, 1400, 1000, 'start'],
    ['within a pixel of the end', 399.5, 1400, 1000, 'start'],
  ])('answers the directions a board that %s can still scroll', (_description, scrollLeft, scrollWidth, clientWidth, expected) => {
    expect(overflowDirectionsOf(scrollLeft, scrollWidth, clientWidth)).toBe(expected);
  });
});
