/**
 * A ticket's link to its row, its agents and its hold. What callers rely on: a link moves the ticket to another row and frees the row it
 * left, and takes a row another ticket owns only when asked, freeing that ticket too, so the two files never name different rows; an
 * agent change is judged on the resolved pair and refused for a ticket no agent works again; a hold and an unhold undo each other, an
 * empty reason holds, and each is refused where it would change nothing; and the paused build row is found only for an in-progress
 * ticket, the one whose build a dispatcher may resume. Refusals are asserted by reason code, before anything changed.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture } from '../../testing/BoardFixtures';
import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures';
import type { BoardRefusalDetail } from './BoardRefusal';

const CHANGED_AT = '2026-09-18T15:00:00+02:00';

/** The change is refused with the given reason, and the records are left exactly as they were. */
function expectRefusedWithNothingChanged(fixture: BoardFixture, change: () => unknown, reason: BoardRefusalDetail['reason']): BoardRefusalDetail {
  const progressBefore = structuredClone(fixture.progress);
  const ticketsBefore  = structuredClone(fixture.tickets);
  const detail         = refusalDetailOf(change);
  expect(detail.reason).toBe(reason);
  expect(fixture.progress).toEqual(progressBefore);
  expect(fixture.tickets).toEqual(ticketsBefore);
  expect(fixture.records).toEqual([]);
  expect(fixture.board.changedTickets()).toEqual([]);
  return detail;
}

describe('linkTicketToTask', () => {
  test('a link moves the ticket to another row and clears the row it left, logging nothing', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '001' }), taskFixture({ id: 2, name: 'Example free-standing task' })],
      tickets: [ticketFixture({ id: '001', task: 1 })],
    });
    const linked = board.linkTicketToTask('001', 2, { movesTheLink: false });

    expect(tickets).toEqual([linked]);
    expect(linked.frontmatter.task).toBe(2);
    expect(progress.tasks.map((task) => task.ticket)).toEqual([null, '001']);
    expect(records).toEqual([]);
    expect(board.changedTickets()).toEqual([linked]);
  });

  test('linking a ticket to the row it already has changes nothing but marks the ticket, as the link is written again', () => {
    const { board, progress } = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '001' })],
      tickets: [ticketFixture({ id: '001', task: 1 })],
    });
    board.linkTicketToTask('001', 1, { movesTheLink: false });

    expect(progress.tasks[0]?.ticket).toBe('001');
    expect(board.changedTickets().map((ticket) => ticket.frontmatter.task)).toEqual([1]);
  });

  test('a row no tracker holds is refused as an unknown task', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    const detail  = expectRefusedWithNothingChanged(fixture, () => fixture.board.linkTicketToTask('001', 9, { movesTheLink: true }), 'unknown-task');
    expect(detail).toEqual({ reason: 'unknown-task', taskId: 9 });
  });

  test('a row another ticket owns is refused unless the link is moved, naming the owner as the row stores it', () => {
    const fixture = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '2' })],
      tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002', task: 1 })],
    });
    const detail = expectRefusedWithNothingChanged(fixture, () => fixture.board.linkTicketToTask('001', 1, { movesTheLink: false }), 'task-belongs-to-another-ticket');
    expect(detail).toEqual({
      reason:         'task-belongs-to-another-ticket',
      taskId:         1,
      owningTicketId: '2',
      ticketId:       '001',
    });
  });

  // The previous owner would otherwise still name the row, and two tickets would claim one bar.
  test('moving the link takes the row from its owner, nulling the owner\'s task, and marks the owner before the ticket', () => {
    const {
      board,
      progress,
      tickets,
    } = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '002' }), taskFixture({ id: 2, ticket: '001' })],
      tickets: [ticketFixture({ id: '001', task: 2 }), ticketFixture({ id: '002', task: 1 })],
    });
    board.linkTicketToTask('001', 1, { movesTheLink: true });

    expect(tickets.map((ticket) => ticket.frontmatter.task)).toEqual([1, null]);
    expect(progress.tasks.map((task) => task.ticket)).toEqual(['001', null]);
    expect(board.changedTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['002', '001']);
  });

  test('an owner whose task names another row keeps it, and is not marked', () => {
    const { board, tickets } = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '002' }), taskFixture({ id: 2, ticket: '002' })],
      tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002', task: 2 })],
    });
    board.linkTicketToTask('001', 1, { movesTheLink: true });

    expect(tickets.map((ticket) => ticket.frontmatter.task)).toEqual([1, 2]);
    expect(board.changedTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['001']);
  });
});

describe('setTicketAgents', () => {
  test('naming a new model changes only the model and logs both resolved pairs', () => {
    const {
      board,
      tickets,
      records,
    } = boardFixture({ tickets: [ticketFixture({ id: '001', effort: 'high' })] });
    const changed = board.setTicketAgents('001', { model: 'sonnet' }, CHANGED_AT);

    expect(tickets[0]?.frontmatter).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(records).toEqual([{
      at:       CHANGED_AT,
      kind:     'ticket-agents-changed',
      ticketId: '001',
      fields:   { from: { model: 'opus', effort: 'high' }, to: { model: 'sonnet', effort: 'high' } },
    }]);
    expect(changed.logged).toEqual(records);
    expect(board.changedTickets()).toEqual([changed.ticket]);
  });

  // A ticket left to the defaults already runs on them, so naming them is no change, and nothing is written for it.
  test('naming the pair a ticket already resolves to is refused as unchanged, even when the file does not name it', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    const detail  = expectRefusedWithNothingChanged(fixture, () => fixture.board.setTicketAgents('001', { model: 'opus', effort: 'medium' }, CHANGED_AT), 'agents-unchanged');
    expect(detail).toEqual({
      reason:   'agents-unchanged',
      ticketId: '001',
      status:   'pending',
      agents:   { model: 'opus', effort: 'medium' },
    });
  });

  test('a delivered or abandoned ticket is refused an agent change, since no agent works it again', () => {
    for (const status of ['delivered', 'abandoned'] as const) {
      const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', status })] });
      const detail  = expectRefusedWithNothingChanged(fixture, () => fixture.board.setTicketAgents('001', { model: 'sonnet' }, CHANGED_AT), 'agents-of-a-settled-ticket');
      expect(detail).toEqual({ reason: 'agents-of-a-settled-ticket', ticketId: '001', status });
    }
  });
});

describe('holdTicket and unholdTicket', () => {
  test('a hold and an unhold undo each other, each logged and each marking the ticket', () => {
    const {
      board,
      tickets,
      records,
    } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    const held = board.holdTicket('001', 'waiting on design', CHANGED_AT);
    expect(tickets[0]?.frontmatter.hold).toBe('waiting on design');
    const unheld = board.unholdTicket('001', CHANGED_AT);

    expect(tickets[0]?.frontmatter).not.toHaveProperty('hold');
    expect(records).toEqual([
      {
        at:       CHANGED_AT,
        kind:     'ticket-held',
        ticketId: '001',
        fields:   { reason: 'waiting on design' },
      },
      {
        at:       CHANGED_AT,
        kind:     'ticket-unheld',
        ticketId: '001',
        fields:   {},
      },
    ]);
    expect([...held.logged, ...unheld.logged]).toEqual(records);
    expect(board.changedTickets()).toEqual([unheld.ticket]);
    expect(tickets).toEqual([held.ticket]);
  });

  test('an empty reason holds the ticket all the same', () => {
    const { board, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    board.holdTicket('001', '', CHANGED_AT);
    expect(tickets[0]?.frontmatter.hold).toBe('');
    expect(board.heldTicketIds()).toEqual(['001']);
  });

  test('a ticket already held is refused a second hold, and one not held is refused an unhold', () => {
    const heldFixture = boardFixture({ tickets: [ticketFixture({ id: '001', hold: '' })] });
    expectRefusedWithNothingChanged(heldFixture, () => heldFixture.board.holdTicket('001', 'again', CHANGED_AT), 'ticket-already-held');

    const unheldFixture = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    expectRefusedWithNothingChanged(unheldFixture, () => unheldFixture.board.unholdTicket('001', CHANGED_AT), 'ticket-not-held');
  });

  // Settled comes first: a delivered ticket that is still held is told no agent works it again, not that it is held.
  test('a delivered or abandoned ticket is refused a hold and an unhold, whatever its hold, naming the action', () => {
    for (const status of ['delivered', 'abandoned'] as const) {
      const heldFixture = boardFixture({ tickets: [ticketFixture({ id: '001', status, hold: '' })] });
      const holdDetail  = expectRefusedWithNothingChanged(heldFixture, () => heldFixture.board.holdTicket('001', '', CHANGED_AT), 'hold-of-a-settled-ticket');
      expect(holdDetail).toEqual({
        reason:   'hold-of-a-settled-ticket',
        ticketId: '001',
        status,
        action:   'hold',
      });

      const unheldFixture = boardFixture({ tickets: [ticketFixture({ id: '001', status })] });
      const unholdDetail  = expectRefusedWithNothingChanged(unheldFixture, () => unheldFixture.board.unholdTicket('001', CHANGED_AT), 'hold-of-a-settled-ticket');
      expect(unholdDetail).toMatchObject({ action: 'unhold' });
    }
  });
});

describe('pausedBuildRowOf', () => {
  test('an in-progress ticket whose row is paused has that row as its paused build', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 4, status: 'paused', ticket: '001' })],
      tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 4 })],
    });
    expect(board.pausedBuildRowOf('001')?.id).toBe(4);
  });

  test('a ticket with a running row, no row, or a paused row while not in progress has no paused build', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 1, status: 'in-progress', ticket: '001' }),
        taskFixture({ id: 3, status: 'paused', ticket: '003' }),
      ],
      tickets: [
        ticketFixture({ id: '001', status: 'in-progress', task: 1 }),
        ticketFixture({ id: '002', status: 'in-progress' }),
        ticketFixture({ id: '003', status: 'in-review', task: 3 }),
        ticketFixture({ id: '004', status: 'in-progress', task: 9 }),
      ],
    });
    for (const ticketId of ['001', '002', '003', '004']) {
      expect(board.pausedBuildRowOf(ticketId), ticketId).toBeNull();
    }
  });
});
