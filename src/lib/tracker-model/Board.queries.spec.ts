/**
 * The Board's readings. What callers rely on: a ticket reference typed on the command line resolves however it was padded or prefixed,
 * and text that is no reference resolves to nothing rather than to a ticket; a task is found by its id alone; the concurrency is the
 * one `ConcurrencyUtil` reads over the Board's rows; the stored run id is read as stored; a dependency the board does not hold still
 * counts as unsettled; only a low ticket is held back, by normal or high work still owed; the ready tickets come in the order to take
 * them; the held ids leave out settled tickets; and a settled check judges the record handed in, never another found by its id.
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
  expect(board.ticketIdsHoldingBack('004')).toEqual(['001', '003']);
  expect(board.ticketIdsHoldingBack('001')).toEqual([]);

  const settledTickets          = [ticketFixture({ id: '001', status: 'delivered' }), ticketFixture({ id: '002', priority: 'low' })];
  const { board: settledBoard } = boardFixture({ tickets: settledTickets });
  expect(settledBoard.ticketIdsHoldingBack('002')).toEqual([]);
});

test('ready tickets come high first and then by id, each pending and with every dependency settled', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'reviewed' }),
      ticketFixture({ id: '002' }),
      ticketFixture({ id: '003', priority: 'high', dependsOn: ['001'] }),
      ticketFixture({ id: '004', dependsOn: ['002'] }),
      ticketFixture({ id: '005', status: 'in-progress' }),
      ticketFixture({ id: '010', priority: 'high' }),
    ],
  });
  expect(board.readyTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['003', '010', '002']);
});

// A low ticket is the orchestrator's to triage, so it is offered only once no normal or high work is owed.
test('a low ticket is held back from the ready tickets while normal or high work is owed', () => {
  const { board: busyBoard } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-review' }), ticketFixture({ id: '002', priority: 'low' })] });
  expect(busyBoard.readyTickets()).toEqual([]);

  const { board: quietBoard } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'delivered' }), ticketFixture({ id: '002', priority: 'low' })] });
  expect(quietBoard.readyTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['002']);
});

test('the held ids are every held ticket an agent may still work, in progress and in review included, and no settled one', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', hold: '' }),
      ticketFixture({ id: '002', status: 'in-progress', hold: 'waiting on design' }),
      ticketFixture({ id: '003', status: 'in-review', hold: '' }),
      ticketFixture({ id: '004', status: 'delivered', hold: '' }),
      ticketFixture({ id: '005', status: 'abandoned', hold: '' }),
      ticketFixture({ id: '006' }),
    ],
  });
  expect(board.heldTicketIds()).toEqual(['001', '002', '003']);
});

// Rows or tickets sharing a hand-duplicated id must each be judged on their own status, never on the first one found by that id.
test('the settled checks read the record handed in, so a hand-duplicated id cannot borrow a verdict', () => {
  const deliveredRow    = taskFixture({ id: 3, status: 'delivered' });
  const pendingRow      = taskFixture({ id: 3, status: 'pending' });
  const settledTicket   = ticketFixture({ id: '001', status: 'abandoned' });
  const unsettledTicket = ticketFixture({ id: '001', status: 'in-review' });
  const { board }       = boardFixture({ tasks: [deliveredRow, pendingRow], tickets: [settledTicket, unsettledTicket] });

  expect([board.taskIsSettled(deliveredRow), board.taskIsSettled(pendingRow)]).toEqual([true, false]);
  expect([board.ticketIsSettled(settledTicket), board.ticketIsSettled(unsettledTicket)]).toEqual([true, false]);
});
