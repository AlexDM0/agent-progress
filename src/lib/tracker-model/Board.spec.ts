/**
 * What every caller of the Board relies on, whichever method it calls: building a Board does no work, so a command that refuses before
 * changing anything leaves the records as read; and the tickets it reports as changed are exactly the ones the writer must write, so
 * a method that changes no ticket must mark none, or an untouched ticket file is rewritten. One row per method.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures';
import type { Board }                               from './Board';

const CHANGED_AT = '2026-09-18T20:40:00+02:00';

function populatedBoardFixture(): ReturnType<typeof boardFixture> {
  return boardFixture({
    tasks: [
      taskFixture({
        id:     1,
        name:   '#001 Example checkout page',
        status: 'in-progress',
        ticket: '001',
        agent:  '001',
      }),
      taskFixture({ id: 2, name: 'Example free-standing task' }),
    ],
    tickets: [
      ticketFixture({ id: '001', status: 'in-progress', task: 1 }),
      ticketFixture({ id: '002', title: 'Example basket badge', hold: '' }),
    ],
    concurrencyLimit: 3,
  });
}

test('building a Board leaves the records as they were read, logs nothing and marks no ticket changed', () => {
  const fixture        = populatedBoardFixture();
  const progressAsRead = structuredClone(fixture.progress);
  const ticketsAsRead  = structuredClone(fixture.tickets);
  const {
    board,
    progress,
    tickets,
    records,
  } = fixture;

  expect(progress).toEqual(progressAsRead);
  expect(tickets).toEqual(ticketsAsRead);
  expect(records).toEqual([]);
  expect(board.changedTickets()).toEqual([]);
});

const CALLS_THAT_CHANGE_NO_TICKET: readonly (readonly [string, (board: Board) => unknown])[] = [
  ['setChartRange', (board) => board.setChartRange({ kind: 'auto' }, CHANGED_AT)],
  ['setConcurrencyLimit', (board) => board.setConcurrencyLimit(4, CHANGED_AT)],
  ['setDispatcherState', (board) => board.setDispatcherState('running', 'example-run', CHANGED_AT)],
  ['recordNote', (board) => board.recordNote('Example note from the orchestrator', CHANGED_AT)],
  ['tasks', (board) => board.tasks()],
  ['tickets', (board) => board.tickets()],
  ['taskById', (board) => board.taskById(1)],
  ['ticketByReference', (board) => board.ticketByReference('1')],
  ['concurrency', (board) => board.concurrency()],
  ['dispatcherState', (board) => board.dispatcherState()],
  ['dispatcherRunId', (board) => board.dispatcherRunId()],
  ['changedTickets', (board) => board.changedTickets()],
];

describe('the tickets a method marks changed', () => {
  for (const [methodName, call] of CALLS_THAT_CHANGE_NO_TICKET) {
    // Marking one of these would rewrite a ticket file that nothing changed, which a person editing it by hand would lose.
    test(`${methodName} marks no ticket changed`, () => {
      const { board } = populatedBoardFixture();
      call(board);
      expect(board.changedTickets()).toEqual([]);
    });
  }
});
