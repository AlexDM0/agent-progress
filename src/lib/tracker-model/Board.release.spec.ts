/**
 * A release reviews then delivers each ticket in the order given and closes the bundle's in-progress review bars after the moves. The
 * Board reads no name, as ingestion links a legacy bar before the Board sees it.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture }                        from '../../testing/BoardFixtures';
import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures';
import { refusalIsBoardRefusal }                    from './BoardRefusal';
import { TICKET_STATUSES }                          from './constants/Statuses';

const STARTED_AT  = '2026-09-18T10:00:00+02:00';
const FINISHED_AT = '2026-09-18T12:00:00+02:00';
const RELEASED_AT = '2026-09-18T15:00:00+02:00';

const RELEASE = { branch: 'ticket/example-checkout', commit: 'a1b2c3d4e5f6' } as const;

function ticketInReviewFixture(ticketId: string, taskId: number): ReturnType<typeof ticketFixture> {
  return ticketFixture({
    id:       ticketId,
    status:   'in-review',
    started:  STARTED_AT,
    finished: FINISHED_AT,
    task:     taskId,
  });
}

function rowInReviewFixture(taskId: number, ticketId: string): ReturnType<typeof taskFixture> {
  return taskFixture({
    id:     taskId,
    name:   `#${ticketId} Example checkout page`,
    status: 'in-review',
    start:  STARTED_AT,
    end:    FINISHED_AT,
    ticket: ticketId,
  });
}

function reviewBarFixture(taskId: number, ticketId: string, status: 'in-progress' | 'delivered'): ReturnType<typeof taskFixture> {
  return taskFixture({
    id:       taskId,
    name:     `Review 1 #${ticketId} — Example checkout page`,
    status,
    start:    FINISHED_AT,
    reviewOf: ticketId,
  });
}

function bundleInReviewFixture(): BoardFixture {
  return boardFixture({
    tasks: [
      rowInReviewFixture(1, '001'),
      rowInReviewFixture(2, '002'),
      reviewBarFixture(3, '001', 'delivered'),
      reviewBarFixture(4, '001', 'in-progress'),
      reviewBarFixture(5, '002', 'in-progress'),
      taskFixture({
        id:     6,
        name:   'Review 2 #001 — Example checkout page',
        status: 'in-progress',
        start:  FINISHED_AT,
      }),
    ],
    tickets: [ticketInReviewFixture('001', 1), ticketInReviewFixture('002', 2)],
  });
}

describe('ticketIsReleasable', () => {
  test('only a ticket in progress or in review can be released', () => {
    const { board } = boardFixture();
    const releasableStatuses = TICKET_STATUSES.filter((status) => board.ticketIsReleasable(ticketFixture({ status })));
    expect(releasableStatuses).toEqual(['in-progress', 'in-review']);
  });
});

describe('releaseTickets', () => {
  test('a ticket is reviewed and then delivered, with the branch and the commit recorded, and its row follows', () => {
    const { board, progress, records } = boardFixture({ tasks: [rowInReviewFixture(1, '001')], tickets: [ticketInReviewFixture('001', 1)] });
    const released                     = board.releaseTickets(['001'], RELEASE, RELEASED_AT);

    expect(released.tickets[0]?.frontmatter).toMatchObject({
      status:    'delivered',
      finished:  FINISHED_AT,
      delivered: RELEASED_AT,
      branch:    RELEASE.branch,
      commit:    RELEASE.commit,
    });
    expect(progress.tasks[0]).toMatchObject({ status: 'delivered', reviewed: RELEASED_AT });
    expect(records.map((record) => record.kind)).toEqual(['ticket-approved', 'ticket-delivered']);
    expect(released.closedReviewBars).toEqual([]);
  });

  test('the log holds two moves per ticket in the order given, then one closure per review bar', () => {
    const { board, records } = bundleInReviewFixture();
    const released           = board.releaseTickets(['002', '001', '002'], RELEASE, RELEASED_AT);

    expect(released.tickets.map((ticket) => ticket.frontmatter.id)).toEqual(['002', '001']);
    expect(records.map((record) => [record.kind, 'ticketId' in record ? record.ticketId : null])).toEqual([
      ['ticket-approved', '002'],
      ['ticket-delivered', '002'],
      ['ticket-approved', '001'],
      ['ticket-delivered', '001'],
      ['review-bar-closed', '001'],
      ['review-bar-closed', '002'],
    ]);
    expect(released.logged).toEqual(records);
  });

  // The reviewer releases as the last step of its pass, so its bar ends here; the Board reads no name, since ingestion links a legacy bar.
  test('every review bar of the bundle in progress is closed, and an earlier bar and a record without reviewOf are left alone', () => {
    const { board, progress } = bundleInReviewFixture();
    const earlierBar          = structuredClone(progress.tasks[2]);
    const released            = board.releaseTickets(['001', '002'], RELEASE, RELEASED_AT);

    expect(released.closedReviewBars.map((bar) => bar.id)).toEqual([4, 5]);
    expect(progress.tasks.filter((task) => task.id === 4 || task.id === 5).map((bar) => [bar.status, bar.end])).toEqual([
      ['delivered', RELEASED_AT],
      ['delivered', RELEASED_AT],
    ]);
    expect(progress.tasks[2]).toEqual(earlierBar);
    expect(progress.tasks[5]?.status).toBe('in-progress');
  });

  test('a ticket that cannot be released is a caller\'s mistake rather than a refusal, and nothing changes', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = boardFixture({ tickets: [ticketInReviewFixture('001', 1), ticketFixture({ id: '002', status: 'pending' })] });
    const progressBefore = structuredClone(progress);
    const ticketsBefore  = structuredClone(tickets);

    let thrown: unknown;
    try {
      board.releaseTickets(['001', '002'], RELEASE, RELEASED_AT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(refusalIsBoardRefusal(thrown)).toBe(false);
    expect(progress).toEqual(progressBefore);
    expect(tickets).toEqual(ticketsBefore);
    expect(records).toEqual([]);
  });
});
