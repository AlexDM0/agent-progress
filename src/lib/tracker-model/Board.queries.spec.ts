/**
 * A ticket reference resolves however it is padded or prefixed, and the ready and held lists keep the order callers rely on. A settled
 * check judges the record handed in, never another found by its id. The status counts cover every ticket, so a reader of the working view
 * can total the board without the full document.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import { Board }                                    from './Board.ts';
import { createLogger }                             from './Logger.ts';

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

test('a ticket waits on its unsettled dependencies only while it is still to be worked on', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'in-review' }),
      ticketFixture({ id: '002', dependsOn: ['001', '009'] }),
      ticketFixture({ id: '003', status: 'abandoned', dependsOn: ['001'] }),
    ],
  });
  expect(board.tickets().map((ticket) => board.waitingOnOf(ticket))).toEqual([[], ['001', '009'], []]);
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

// Ready means build: priority only orders, so owed normal work holds no low ticket back.
test('a low ticket is ready while a normal one is pending and another in review, listed after the normal one', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'in-review' }),
      ticketFixture({ id: '002', priority: 'low' }),
      ticketFixture({ id: '003' }),
    ],
  });
  expect(board.readyTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['003', '002']);
});

test('within a priority the readiness order is the log position of the latest readied or reopened record, a clearing forgetting the earlier ones', () => {
  const at      = '2026-09-26T10:15:00+02:00';
  const tickets = ['001', '002', '003', '004'].map((id) => ticketFixture({ id }));
  const board   = new Board({
    progress:         boardFixture().progress,
    tickets,
    epics:            [],
    logger:           createLogger(() => undefined),
    storedLogRecords: [
      {
        at, kind: 'ticket-readied', ticketId: '001', fields: {}
      },
      { at, kind: 'tracker-cleared', fields: {} },
      {
        at, kind: 'ticket-readied', ticketId: '003', fields: {}
      },
      {
        at, kind: 'ticket-readied', ticketId: '002', fields: {}
      },
      {
        at, kind: 'ticket-reopened', ticketId: '003', fields: {}
      },
    ],
  });
  expect(board.readyTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['001', '004', '002', '003']);

  board.moveTicket('002', 'in-progress', { checksLegality: true }, at);
  board.moveTicket('002', 'pending', { checksLegality: false }, at);
  expect(board.readyTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['001', '004', '003', '002']);
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

/** A normal ticket held, a high one with its agents named, and a low one, beside one agent in flight. */
function boardWithHeldAndLowTickets(): ReturnType<typeof boardFixture> {
  return boardFixture({
    tasks:   [taskFixture({ id: 1, status: 'in-progress' })],
    tickets: [
      ticketFixture({ id: '001', hold: '' }),
      ticketFixture({
        id:       '002',
        priority: 'high',
        model:    'sonnet',
        effort:   'high',
      }),
      ticketFixture({ id: '003', priority: 'low' }),
    ],
    concurrencyLimit: 3,
  });
}

// Callers print this object as it comes, so its key order is part of the document a script reads.
test('the dispatch capacity is the concurrency, then the ready ids in the order to take them, the Overseer state and the held ids', () => {
  const capacity = boardWithHeldAndLowTickets().board.dispatchCapacity();
  expect(Object.keys(capacity)).toEqual(['limit', 'agentsInFlight', 'freeSlots', 'readyTicketIds', 'overseerState', 'heldTicketIds']);
  expect(capacity).toEqual({
    limit:          3,
    agentsInFlight: 1,
    freeSlots:      2,
    readyTicketIds: ['002', '001', '003'],
    overseerState:  'paused',
    heldTicketIds:  ['001'],
  });
});

test('the ready entries list the ready tickets in the same order with every default spelled out, and mark only a held ticket', () => {
  expect(boardWithHeldAndLowTickets().board.readyTicketEntries()).toStrictEqual([
    {
      id:       '002',
      priority: 'high',
      model:    'sonnet',
      effort:   'high',
    },
    {
      id:       '001',
      priority: 'normal',
      model:    'opus',
      effort:   'medium',
      held:     true,
    },
    {
      id:       '003',
      priority: 'low',
      model:    'opus',
      effort:   'medium',
    },
  ]);
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

test('the ticket count by status covers every ticket, settled ones included, and names every status even at zero', () => {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'delivered' }),
      ticketFixture({ id: '002', status: 'delivered' }),
      ticketFixture({ id: '003', status: 'abandoned' }),
      ticketFixture({ id: '004', status: 'in-progress' }),
    ],
  });

  expect(board.ticketCountByStatus()).toEqual({
    'draft': 0, 'pending': 0, 'in-progress': 1, 'in-review': 0, 'reviewed': 0, 'delivered': 2, 'abandoned': 1,
  });
});
