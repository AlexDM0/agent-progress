/**
 * Clearing the tracker. What `clear` relies on: the rows go but the tracker stays the same tracker, so its id and its task id counter
 * survive; every surviving ticket is re-seeded as one row from its own stamps and marked for writing, except a low ticket with no row to
 * lose, which is still counted as surviving; without the tickets, none survive and none is marked; and the clearing is one record,
 * with the Board never touching the stored log, which is the logger's to restart.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture }                        from '../../testing/BoardFixtures';
import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures';

const STARTED_AT   = '2026-09-18T10:00:00+02:00';
const FINISHED_AT  = '2026-09-18T12:00:00+02:00';
const DELIVERED_AT = '2026-09-18T14:00:00+02:00';
const CLEARED_AT   = '2026-09-18T16:00:00+02:00';

function workedBoardFixture(): BoardFixture {
  return boardFixture({
    tasks: [
      taskFixture({ id: 7, status: 'delivered', ticket: '001' }),
      taskFixture({ id: 8, name: '#004 Example checkout page', ticket: '004' }),
    ],
    tickets: [
      ticketFixture({
        id:        '001',
        status:    'delivered',
        started:   STARTED_AT,
        finished:  FINISHED_AT,
        delivered: DELIVERED_AT,
        task:      7,
      }),
      ticketFixture({ id: '002', title: 'Example basket badge' }),
      ticketFixture({ id: '003', priority: 'low' }),
      ticketFixture({ id: '004', priority: 'low', task: 8 }),
    ],
  });
}

describe('with the tickets surviving', () => {
  test('every ticket is re-seeded as one row from its own stamps, numbered on from the counter', () => {
    const { board, progress, tickets } = workedBoardFixture();
    board.clearTracker({ ticketsSurvive: true }, CLEARED_AT);

    expect(progress.tasks.map((task) => [task.id, task.ticket, task.status, task.start, task.end])).toEqual([
      [9, '001', 'delivered', STARTED_AT, FINISHED_AT],
      [10, '002', 'pending', null, null],
      [11, '004', 'pending', null, null],
    ]);
    expect(progress.tasks[0]?.reviewed).toBe(FINISHED_AT);
    expect(tickets.map((ticket) => ticket.frontmatter.task)).toEqual([9, 10, null, 11]);
  });

  // A reopen clears `started`, so the row a low ticket held before the clear is what says it was worked and belongs on the chart.
  test('a low ticket never started gets no row, and one that held a row before the clear gets one again', () => {
    const { board, progress } = workedBoardFixture();
    board.clearTracker({ ticketsSurvive: true }, CLEARED_AT);

    expect(progress.tasks.map((task) => task.ticket)).not.toContain('003');
    expect(progress.tasks.map((task) => task.ticket)).toContain('004');
  });

  test('the tracker keeps its id and its task id counter, and starts again with an automatic range', () => {
    const { board, progress } = workedBoardFixture();
    progress.view             = {
      kind:        'relative',
      from:        '-2h',
      to:          'now',
      tickMinutes: null,
    };
    const cleared             = board.clearTracker({ ticketsSurvive: true }, CLEARED_AT);

    expect(progress).toMatchObject({
      trackerId:  'example-tracker-id',
      startedAt:  CLEARED_AT,
      view:       { kind: 'auto' },
      nextTaskId: 12,
    });
    expect(cleared.removedTaskCount).toBe(2);
  });

  test('every surviving ticket is counted and marked, a low ticket with no row among them', () => {
    const { board } = workedBoardFixture();
    const cleared   = board.clearTracker({ ticketsSurvive: true }, CLEARED_AT);

    expect(cleared.survivingTicketCount).toBe(4);
    expect(board.changedTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['001', '002', '003', '004']);
  });
});

test('without the tickets, the board holds no ticket and no row, and marks none', () => {
  const { board, progress, tickets } = workedBoardFixture();
  const cleared                      = board.clearTracker({ ticketsSurvive: false }, CLEARED_AT);

  expect(progress.tasks).toEqual([]);
  expect(tickets).toEqual([]);
  expect(board.tickets()).toEqual([]);
  expect(cleared).toMatchObject({ removedTaskCount: 2, survivingTicketCount: 0 });
  expect(board.changedTickets()).toEqual([]);
});

// Whether earlier entries survive a clear is the log's own decision, taken where it is stored; the Board reports the event and no more.
test('the clearing is logged as one record, and what becomes of the stored log is the sink\'s decision', () => {
  const { board, records } = workedBoardFixture();
  const cleared            = board.clearTracker({ ticketsSurvive: true }, CLEARED_AT);

  expect(records).toEqual([{ at: CLEARED_AT, kind: 'tracker-cleared', fields: {} }]);
  expect(cleared.logged).toEqual(records);
});
