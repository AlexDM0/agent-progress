/**
 * The facts the page will read from the payload: a ticket's review bars and own row, what a row and a ticket show, and whether a
 * delivered row counts as reviewed. Each case is taken from the page's own specs (`page/kanban/utils/KanbanLaneUtil.spec.ts`,
 * `page/progress/ProgressMarkup.spec.ts`), so the Kanban and the Progress chart agree once they read these instead of their own rules.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { DisplayState, Task, TaskStatus }      from './@types/Task.ts';
import type { Ticket, TicketStatus }                from './@types/Ticket.ts';
import type { Board }                               from './Board.ts';

const REVIEWED_AT = '2026-09-18T21:10:00+02:00';

function firstRowOf(board: Board): Readonly<Task> {
  const [row] = board.tasks();
  if (row === undefined) throw new Error('The board holds no row.');
  return row;
}

function firstTicketOf(board: Board): Readonly<Ticket> {
  const [ticket] = board.tickets();
  if (ticket === undefined) throw new Error('The board holds no ticket.');
  return ticket;
}

const ROW_AND_TICKET_DISPLAY_STATES: readonly (readonly [TaskStatus, TicketStatus, DisplayState])[] = [
  ['pending', 'pending', 'pending'],
  ['in-progress', 'in-progress', 'in-progress'],
  ['paused', 'in-progress', 'paused'],
  ['in-review', 'pending', 'in-review'],
  ['in-review', 'in-review', 'reviewing'],
  ['re-review', 'in-review', 're-review'],
  ['reviewed', 'reviewed', 'reviewed'],
  ['delivered', 'delivered', 'delivered'],
  ['abandoned', 'abandoned', 'abandoned'],
];

describe('reviewBarsOf', () => {
  // The page's review spans and the hook's newest bar both read this order, so a hand-edited array cannot reorder the rounds.
  test('returns the free-standing rows reviewing the ticket, oldest filed first whatever the array order, delivered ones included', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({
          id:       5,
          name:     'Review 2 #003 — Example checkout page',
          status:   'in-progress',
          reviewOf: '003',
        }),
        taskFixture({
          id:       2,
          name:     'Review 1 #003 — Example checkout page',
          status:   'delivered',
          reviewOf: '003',
        }),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review' })],
    });

    expect(board.reviewBarsOf('003').map((task) => task.id)).toEqual([2, 5]);
  });

  test('leaves out a bar of another ticket, a row known only by its name, and a ticket-owned row that names the ticket', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 1, name: 'Review 1 #004 — Example basket badge', reviewOf: '004' }),
        taskFixture({ id: 2, name: 'Review 1 #003 — x' }),
        taskFixture({
          id:       3,
          name:     '#009 Example review pass',
          ticket:   '009',
          reviewOf: '003',
        }),
      ],
      tickets: [ticketFixture({ id: '003' }), ticketFixture({ id: '004' }), ticketFixture({ id: '009' })],
    });

    expect(board.reviewBarsOf('003')).toEqual([]);
  });

  // The hook passes the id its brief names, and credits the bar even when that ticket's file is gone.
  test('returns the bars naming a ticket the board does not hold, without refusing', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, reviewOf: '007' })] });

    expect(board.reviewBarsOf('007').map((task) => task.id)).toEqual([1]);
  });

  test('returns no bars for an id no bar names', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, reviewOf: '001' })] });

    expect(board.reviewBarsOf('007')).toEqual([]);
  });
});

describe('ownRowOf', () => {
  test('finds the row whose ticket is the id', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1 }), taskFixture({ id: 2, ticket: '007' })],
      tickets: [ticketFixture({ id: '007', task: 2 })],
    });

    expect(board.ownRowOf('007')?.id).toBe(2);
  });

  test('never takes a review bar of the ticket for its own row', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, name: 'Review 1 #007 — x', reviewOf: '007' })],
      tickets: [ticketFixture({ id: '007' })],
    });

    expect(board.ownRowOf('007')).toBeNull();
  });

  test('returns nothing for a ticket without a row', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '007' })] });

    expect(board.ownRowOf('007')).toBeNull();
  });

  test('takes the first in the file when two rows name the ticket, whatever their ids', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 2, ticket: '007' }), taskFixture({ id: 1, ticket: '007' })],
      tickets: [ticketFixture({ id: '007', task: 1 })],
    });

    expect(board.tasks().map((task) => task.id)).toEqual([2, 1]);
    expect(board.ownRowOf('007')?.id).toBe(2);
  });
});

describe('rowDisplayStateOf', () => {
  // Every row state the Progress tab can show, so a Kanban card can never disagree with the chart's pill.
  test.each(ROW_AND_TICKET_DISPLAY_STATES)('a row in %s of a ticket in %s shows %s', (rowStatus, ticketStatus, displayState) => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: rowStatus, ticket: '007' })],
      tickets: [ticketFixture({ id: '007', status: ticketStatus, task: 1 })],
    });

    expect(board.rowDisplayStateOf(firstRowOf(board))).toBe(displayState);
  });

  test('an in-review free-standing row shows in-review, as no ticket is being reviewed through it', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, status: 'in-review' })] });

    expect(board.rowDisplayStateOf(firstRowOf(board))).toBe('in-review');
  });

  test('an in-review row of a reviewed ticket shows in-review', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'in-review', ticket: '007' })],
      tickets: [ticketFixture({ id: '007', status: 'reviewed', task: 1 })],
    });

    expect(board.rowDisplayStateOf(firstRowOf(board))).toBe('in-review');
  });
});

describe('ticketDisplayStateOf', () => {
  test.each(ROW_AND_TICKET_DISPLAY_STATES)('a ticket whose own row is %s and whose status is %s shows %s', (rowStatus, ticketStatus, displayState) => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: rowStatus, ticket: '007' })],
      tickets: [ticketFixture({ id: '007', status: ticketStatus, task: 1 })],
    });

    expect(board.ticketDisplayStateOf(firstTicketOf(board))).toBe(displayState);
  });

  // A low ticket never started has no row; its status alone decides what it shows.
  test.each([
    ['pending', 'pending'],
    ['in-progress', 'in-progress'],
    ['in-review', 'reviewing'],
    ['reviewed', 'reviewed'],
    ['delivered', 'delivered'],
    ['abandoned', 'abandoned'],
  ] as readonly (readonly [TicketStatus, DisplayState])[])('a ticket in %s with no row shows %s', (ticketStatus, displayState) => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '007', status: ticketStatus })] });

    expect(board.ticketDisplayStateOf(firstTicketOf(board))).toBe(displayState);
  });

  // Two ticket files a hand edit gave one id each keep their own card state, as they did before the page read the facts.
  test('reads a ticket whose id another ticket file shares by its own status', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '005', status: 'pending' }), ticketFixture({ id: '005', status: 'delivered' })] });

    expect(board.tickets().map((ticket) => board.ticketDisplayStateOf(ticket))).toEqual(['pending', 'delivered']);
  });
});

describe('deliveredRowCountsAsReviewed', () => {
  test('a delivered row with a review stamp counts as reviewed', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, status: 'delivered', reviewed: REVIEWED_AT })] });

    expect(board.deliveredRowCountsAsReviewed(firstRowOf(board))).toBe(true);
  });

  test('a free-standing row delivered straight from in-review, without a stamp, does not count', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, status: 'delivered' })] });

    expect(board.deliveredRowCountsAsReviewed(firstRowOf(board))).toBe(false);
  });

  test('a reviewed row not delivered yet does not count, stamp or not', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, status: 'reviewed', reviewed: REVIEWED_AT })] });

    expect(board.deliveredRowCountsAsReviewed(firstRowOf(board))).toBe(false);
  });

  // Rows written before the stamp existed: delivery of a ticket is only legal from `reviewed`.
  test('a delivered ticket row without a stamp counts as reviewed while its ticket is delivered', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'delivered', ticket: '003' })],
      tickets: [ticketFixture({ id: '003', status: 'delivered', task: 1 })],
    });

    expect(board.deliveredRowCountsAsReviewed(firstRowOf(board))).toBe(true);
  });

  test('the same unstamped row does not count once its ticket is no longer delivered, as after a reopen', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'delivered', ticket: '003' })],
      tickets: [ticketFixture({ id: '003', status: 'pending', task: 1 })],
    });

    expect(board.deliveredRowCountsAsReviewed(firstRowOf(board))).toBe(false);
  });
});
