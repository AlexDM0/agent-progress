/**
 * The Board's readings. What callers rely on: a ticket reference typed on the command line resolves however it was padded or prefixed,
 * and text that is no reference resolves to nothing rather than to a ticket; a task is found by its id alone; the concurrency is the
 * one `ConcurrencyUtil` reads over the Board's rows; the stored run id is read as stored; a dependency the board does not hold still
 * counts as unsettled; and only a low ticket is held back, by normal or high work still owed.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures';

test('a ticket reference resolves written as 3, #3 or 003', () => {
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '003', title: 'Example basket badge' })] });
  for (const reference of ['3', '#3', '003', '#003']) {
    expect(board.ticketByReference(reference)?.frontmatter.title, reference).toBe('Example basket badge');
  }
});

test('a reference to no ticket on the board, or text that is no reference, resolves to nothing', () => {
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
  for (const reference of ['2', '0', 'first', '']) {
    expect(board.ticketByReference(reference), reference).toBeUndefined();
  }
});

test('a task is found by its id, and an id no row holds finds nothing', () => {
  const { board } = boardFixture({ tasks: [taskFixture({ id: 1 }), taskFixture({ id: 4, name: 'Example review pass' })] });
  expect(board.taskById(4)?.name).toBe('Example review pass');
  expect(board.taskById(2)).toBeUndefined();
});

test('the concurrency counts the in-progress rows by agent against the stored limit', () => {
  const { board } = boardFixture({
    tasks: [
      taskFixture({ id: 1, status: 'in-progress', agent: '001,002' }),
      taskFixture({ id: 2, status: 'in-progress', agent: '001,002' }),
      taskFixture({ id: 3, status: 'in-progress' }),
      taskFixture({ id: 4, status: 'paused' }),
    ],
    concurrencyLimit: 3,
  });
  expect(board.concurrency()).toEqual({ limit: 3, agentsInFlight: 2, freeSlots: 1 });
});

test('the dispatcher run id is read as stored, and a tracker that stored none has none', () => {
  const { board, progress } = boardFixture();
  expect(board.dispatcherRunId()).toBeUndefined();
  progress.dispatcherRunId = 'example-run';
  expect(board.dispatcherRunId()).toBe('example-run');
});

// A dependency whose file is gone or unreadable is not finished work, so the ticket waiting on it must still be told it waits.
test('a ticket waits on every dependency not yet reviewed or delivered, and on one the board does not hold', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'reviewed' }),
      ticketFixture({ id: '002', status: 'in-review' }),
      ticketFixture({ id: '003', status: 'delivered' }),
      ticketFixture({ id: '004', dependsOn: ['001', '002', '003', '009'] }),
      ticketFixture({ id: '005' }),
    ],
  });
  expect(board.unsettledDependenciesOf('004')).toEqual(['002', '009']);
  expect(board.unsettledDependenciesOf('005')).toEqual([]);
});

test('a low ticket is held back by every normal or high ticket not yet delivered or abandoned, and any other ticket by none', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'reviewed' }),
      ticketFixture({ id: '002', priority: 'high', status: 'delivered' }),
      ticketFixture({ id: '003', priority: 'high' }),
      ticketFixture({ id: '004', priority: 'low' }),
      ticketFixture({ id: '005', priority: 'low', status: 'in-progress' }),
    ],
  });
  expect(board.lowPriorityWorkHoldingBack('004')).toEqual(['001', '003']);
  expect(board.lowPriorityWorkHoldingBack('001')).toEqual([]);

  const settledTickets          = [ticketFixture({ id: '001', status: 'delivered' }), ticketFixture({ id: '002', priority: 'low' })];
  const { board: settledBoard } = boardFixture({ tickets: settledTickets });
  expect(settledBoard.lowPriorityWorkHoldingBack('002')).toEqual([]);
});
