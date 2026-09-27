/**
 * The ticket and its row move together, the legality table holds unless the caller skips it, and every move except one to review ends the
 * reviewer's bar. Refusals are asserted by reason code, never by wording.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture } from '../../testing/BoardFixtures.ts';
import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures.ts';
import type { TicketStatus } from './@types/Ticket.ts';
import { TICKET_STATUSES }   from './constants/Statuses.ts';
import { TicketMoveUtil }    from './utils/TicketMoveUtil.ts';

const FILED_AT     = '2026-09-18T09:00:00+02:00';
const STARTED_AT   = '2026-09-18T10:00:00+02:00';
const FINISHED_AT  = '2026-09-18T12:00:00+02:00';
const DELIVERED_AT = '2026-09-18T15:00:00+02:00';

const CHECKED = { checksLegality: true } as const;

const EXAMPLE_REASON = 'the export dialog is being replaced';

function pendingTicketFixture(): BoardFixture {
  return boardFixture({ tickets: [ticketFixture({ id: '003', title: 'Example export dialog', type: 'bug' })] });
}

describe('a move and its row', () => {
  test('start puts the ticket in progress, stamps started, and sets its row in-progress', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = pendingTicketFixture();
    const moved = board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);

    expect(tickets[0]).toBe(moved.ticket);
    expect(moved.ticket.frontmatter).toMatchObject({ status: 'in-progress', started: STARTED_AT, updated: STARTED_AT });
    expect(progress.tasks).toHaveLength(1);
    expect(progress.tasks[0]).toMatchObject({
      name:   '#003 Example export dialog',
      status: 'in-progress',
      start:  STARTED_AT,
      ticket: '003',
    });
    expect(moved.ticket.frontmatter.task).toBe(progress.tasks[0]?.id ?? 0);
    expect(records).toEqual([{
      at:       STARTED_AT,
      kind:     'ticket-started',
      ticketId: '003',
      fields:   {},
    }]);
    expect(moved.logged).toEqual(records);
  });

  test('a move to in-review stamps finished and sets the row in-review', () => {
    const { board, progress, records } = pendingTicketFixture();
    board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);
    const moved = board.moveTicket('003', 'in-review', CHECKED, FINISHED_AT);

    expect(moved.ticket.frontmatter).toMatchObject({ status: 'in-review', finished: FINISHED_AT });
    expect(progress.tasks[0]).toMatchObject({ status: 'in-review', end: FINISHED_AT });
    expect(records.at(-1)?.kind).toBe('ticket-finished');
  });

  test('a move to reviewed sets the row reviewed and stamps finished when the ticket never went through review', () => {
    const { board, progress, records } = pendingTicketFixture();
    const moved                        = board.moveTicket('003', 'reviewed', { checksLegality: false }, FINISHED_AT);

    expect(moved.ticket.frontmatter.finished).toBe(FINISHED_AT);
    expect(progress.tasks[0]?.status).toBe('reviewed');
    expect(records.at(-1)?.kind).toBe('ticket-approved');
  });

  test('deliver stamps delivered, sets the row delivered, and leaves an earlier finish alone', () => {
    const { board, progress, records } = pendingTicketFixture();
    board.moveTicket('003', 'reviewed', { checksLegality: false }, FINISHED_AT);
    const moved = board.moveTicket('003', 'delivered', CHECKED, DELIVERED_AT);

    expect(moved.ticket.frontmatter).toMatchObject({ status: 'delivered', finished: FINISHED_AT, delivered: DELIVERED_AT });
    expect(progress.tasks[0]?.status).toBe('delivered');
    expect(records.at(-1)?.kind).toBe('ticket-delivered');
  });

  test('abandon stamps abandonedAt, records the reason, and puts it in the log line', () => {
    const { board, progress, records } = pendingTicketFixture();
    board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);
    const moved = board.moveTicket('003', 'abandoned', { checksLegality: true, reason: EXAMPLE_REASON }, FINISHED_AT);

    expect(moved.ticket.frontmatter).toMatchObject({ status: 'abandoned', abandonedAt: FINISHED_AT, reason: EXAMPLE_REASON });
    expect(progress.tasks[0]).toMatchObject({ status: 'abandoned', end: FINISHED_AT });
    expect(records.at(-1)).toEqual({
      at:       FINISHED_AT,
      kind:     'ticket-abandoned',
      ticketId: '003',
      fields:   { reason: EXAMPLE_REASON },
    });
  });

  test('reopen clears every timestamp and the reason, and the row goes back to pending', () => {
    const { board, progress, records } = pendingTicketFixture();
    board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);
    board.moveTicket('003', 'abandoned', { checksLegality: true, reason: 'superseded' }, FINISHED_AT);
    const moved = board.moveTicket('003', 'pending', CHECKED, DELIVERED_AT);

    expect(moved.ticket.frontmatter).toMatchObject({
      status:      'pending',
      started:     null,
      finished:    null,
      delivered:   null,
      abandonedAt: null,
    });
    expect(moved.ticket.frontmatter.reason).toBeUndefined();
    expect(progress.tasks[0]).toMatchObject({ status: 'pending', start: null });
    expect(records.at(-1)?.kind).toBe('ticket-reopened');
  });

  // `ticket start` on a ticket back from review is rework: the bar still began when the work first did.
  test('a ticket started again after review keeps its first start and only moves updated', () => {
    const { board, progress } = pendingTicketFixture();
    board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);
    board.moveTicket('003', 'in-review', CHECKED, FINISHED_AT);
    const moved = board.moveTicket('003', 'in-progress', CHECKED, DELIVERED_AT);

    expect(moved.ticket.frontmatter).toMatchObject({ started: STARTED_AT, updated: DELIVERED_AT });
    expect(progress.tasks[0]?.start).toBe(STARTED_AT);
    expect(progress.tasks).toHaveLength(1);
  });

  test('a ticket whose row was cleared away gets a new one rather than a refusal', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '003', task: 99 })] });
    const moved               = board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);

    expect(progress.tasks).toHaveLength(1);
    expect(moved.ticket.frontmatter.task).toBe(progress.tasks[0]?.id ?? 0);
    expect(progress.tasks[0]?.status).toBe('in-progress');
  });

  test('a branch and a commit handed to a transition are recorded on the ticket', () => {
    const { board } = pendingTicketFixture();
    const moved     = board.moveTicket('003', 'reviewed', {
      checksLegality: false,
      branch:         'ticket/export-dialog',
      commit:         'a1b2c3d',
    }, FINISHED_AT);

    expect(moved.ticket.frontmatter).toMatchObject({ branch: 'ticket/export-dialog', commit: 'a1b2c3d' });
  });
});

describe('refusals', () => {
  // `ticket status` skips the table, never this: a move that changes nothing would still log a line and stamp `updated`.
  test('a move to the status the ticket already has is refused whether or not legality is checked, and nothing changes', () => {
    for (const checksLegality of [true, false]) {
      const { board, progress, tickets } = pendingTicketFixture();
      const ticketsAsRead                = structuredClone(tickets);

      expect(refusalDetailOf(() => board.moveTicket('003', 'pending', { checksLegality }, STARTED_AT)), String(checksLegality))
        .toEqual({ reason: 'ticket-already-in-status', ticketId: '003', status: 'pending' });
      expect(tickets).toEqual(ticketsAsRead);
      expect(progress.tasks).toEqual([]);
      expect(board.changedTickets()).toEqual([]);
    }
  });

  test('a move the table does not allow is refused, and skipping the check lets it through', () => {
    const { board } = pendingTicketFixture();
    expect(refusalDetailOf(() => board.moveTicket('003', 'delivered', CHECKED, DELIVERED_AT))).toEqual({
      reason:       'illegal-ticket-move',
      ticketId:     '003',
      status:       'pending',
      targetStatus: 'delivered',
    });
    expect(board.moveTicket('003', 'delivered', { checksLegality: false }, DELIVERED_AT).ticket.frontmatter.status).toBe('delivered');
  });

  // The table itself is pinned beside it; this pins that the Board consults it for every pair, and for nothing else.
  test('every pair of statuses is moved or refused exactly as the legality table says', () => {
    for (const status of TICKET_STATUSES) {
      for (const targetStatus of TICKET_STATUSES.filter((candidate) => candidate !== status)) {
        const { board } = boardFixture({ tickets: [ticketFixture({ id: '003', status, started: status === 'pending' ? null : FILED_AT })] });
        const move      = (): unknown => board.moveTicket('003', targetStatus, { checksLegality: true, reason: 'Example reason' }, STARTED_AT);
        const pair      = `${status} → ${targetStatus}`;

        if (TicketMoveUtil.ticketMoveIsLegal(status, targetStatus)) {
          expect(move, pair).not.toThrow();
        } else {
          expect(refusalDetailOf(move), pair).toEqual({
            reason:   'illegal-ticket-move',
            ticketId: '003',
            status,
            targetStatus,
          });
        }
      }
    }
  });

  test('abandoning without a reason is refused, and nothing about the ticket moves', () => {
    for (const reason of [undefined, '', '  ']) {
      const { board, progress, tickets } = pendingTicketFixture();
      const request                      = { checksLegality: true, ...(reason === undefined ? {} : { reason }) };

      expect(refusalDetailOf(() => board.moveTicket('003', 'abandoned', request, FINISHED_AT)), String(reason))
        .toEqual({ reason: 'abandon-without-reason', ticketId: '003' });
      expect(tickets[0]?.frontmatter).toMatchObject({ status: 'pending', abandonedAt: null, updated: FILED_AT });
      expect(progress.tasks).toEqual([]);
      expect(board.changedTickets()).toEqual([]);
    }
  });
});

describe('tokens', () => {
  test('a count handed to a move replaces what the ticket\'s row held', () => {
    const { board, progress } = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '003', tokens: 4_000 })],
      tickets: [ticketFixture({ id: '003', task: 1 })],
    });
    board.moveTicket('003', 'in-progress', { checksLegality: true, tokens: 12_000 }, STARTED_AT);
    expect(progress.tasks[0]?.tokens).toBe(12_000);
  });

  // A low ticket reopened before it was ever started has no row, so the count has nowhere to go and must not be dropped silently.
  test('a count for a ticket the move leaves without a row is refused', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '003', priority: 'low', status: 'in-review' })] });
    expect(refusalDetailOf(() => board.moveTicket('003', 'pending', { checksLegality: true, tokens: 500 }, STARTED_AT)))
      .toEqual({ reason: 'tokens-without-a-row', ticketId: '003' });
    expect(progress.tasks).toEqual([]);
  });
});

describe('a low ticket and the chart', () => {
  test('a low ticket gets its row when it is started and keeps it through a reopen', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '003', priority: 'low' })] });
    const started             = board.moveTicket('003', 'in-progress', CHECKED, STARTED_AT);
    const rowId               = started.ticket.frontmatter.task;
    const reopened            = board.moveTicket('003', 'pending', CHECKED, FINISHED_AT);

    expect(rowId).not.toBeNull();
    expect(reopened.ticket.frontmatter.task).toBe(rowId);
    expect([rowId]).toEqual(progress.tasks.map((task) => task.id));
    expect(progress.tasks[0]?.status).toBe('pending');
  });

  test('a low ticket abandoned before it was ever started gets no row', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '003', priority: 'low' })] });
    const moved               = board.moveTicket('003', 'abandoned', { checksLegality: true, reason: 'Example reason' }, FINISHED_AT);

    expect(moved.ticket.frontmatter.task).toBeNull();
    expect(progress.tasks).toEqual([]);
    expect(progress.nextTaskId).toBe(1);
  });
});

describe('review bars a move ends', () => {
  const REVIEW_BAR_NAME = 'Review 1 #001 — Example checkout page';

  function ticketUnderReviewFixture(): BoardFixture {
    return boardFixture({
      tasks: [
        taskFixture({
          id:     1,
          name:   '#001 Example checkout page',
          status: 'in-review',
          start:  FILED_AT,
          end:    STARTED_AT,
          ticket: '001',
        }),
        taskFixture({
          id:       2,
          name:     REVIEW_BAR_NAME,
          status:   'in-progress',
          start:    STARTED_AT,
          reviewOf: '001',
        }),
        // An older bar that names its ticket only in its name: the page may nest it, but nothing may move it.
        taskFixture({
          id:     3,
          name:   REVIEW_BAR_NAME,
          status: 'in-progress',
          start:  STARTED_AT,
        }),
      ],
      tickets: [ticketFixture({
        id:       '001',
        status:   'in-review',
        started:  FILED_AT,
        finished: STARTED_AT,
        task:     1,
      })],
    });
  }

  const TARGETS_THAT_END_REVIEW: readonly TicketStatus[] = ['pending', 'in-progress', 'reviewed', 'delivered', 'abandoned'];

  for (const targetStatus of TARGETS_THAT_END_REVIEW) {
    test(`a move to ${targetStatus} finishes and delivers the ticket's in-progress bar and logs it after the move`, () => {
      const { board, progress, records } = ticketUnderReviewFixture();
      const moved                        = board.moveTicket('001', targetStatus, { checksLegality: false, reason: 'Example reason' }, DELIVERED_AT);
      const bar                          = progress.tasks.find((task) => task.id === 2);

      expect(moved.closedReviewBars.map((closedBar) => closedBar.id)).toEqual([2]);
      expect(bar).toMatchObject({ status: 'delivered', end: DELIVERED_AT });
      expect(bar?.history).toEqual([{ status: 'in-review', at: DELIVERED_AT }, { status: 'delivered', at: DELIVERED_AT }]);
      expect(records.map((record) => record.kind).at(-1)).toBe('review-bar-closed');
      expect(records.at(-1)).toEqual({
        at:       DELIVERED_AT,
        kind:     'review-bar-closed',
        taskId:   2,
        ticketId: '001',
        fields:   { name: REVIEW_BAR_NAME },
      });
      expect(moved.logged).toEqual(records);
      expect(progress.tasks.find((task) => task.id === 3)?.status).toBe('in-progress');
    });
  }

  test('a move to in-review leaves the reviewer at work', () => {
    const { board, progress, records } = ticketUnderReviewFixture();
    board.moveTicket('001', 'in-progress', CHECKED, DELIVERED_AT);
    progress.tasks.push(taskFixture({
      id:       4,
      name:     'Review 2 #001 — Example checkout page',
      status:   'in-progress',
      reviewOf: '001',
    }));
    const moved = board.moveTicket('001', 'in-review', CHECKED, DELIVERED_AT);

    expect(moved.closedReviewBars).toEqual([]);
    expect(progress.tasks.find((task) => task.id === 4)?.status).toBe('in-progress');
    expect(records.at(-1)?.kind).toBe('ticket-finished');
  });
});
