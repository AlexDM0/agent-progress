/**
 * A claim starts every ticket named as one agent, all or nothing, with its refusals in a fixed order so the one reported is predictable.
 * The limit counts agents, not rows.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture } from '../../testing/BoardFixtures.ts';
import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures.ts';
import type { TicketClaim }        from './@types/BoardChanges.ts';
import type { BoardRefusalDetail } from './BoardRefusal.ts';

const STARTED_AT = '2026-09-18T10:00:00+02:00';
const CLAIMED_AT = '2026-09-18T11:00:00+02:00';

/** The refusal, and proof that it left the records, the log and the changed tickets as they were. */
function refusalOfAClaimOn(fixture: BoardFixture, ticketIds: readonly string[], claim: TicketClaim = {}): BoardRefusalDetail {
  const progressBefore = structuredClone(fixture.progress);
  const ticketsBefore  = structuredClone(fixture.tickets);
  const detail         = refusalDetailOf(() => fixture.board.claimTickets(ticketIds, { owner: 'Alex Example', ...claim }, CLAIMED_AT));
  expect(fixture.progress).toEqual(progressBefore);
  expect(fixture.tickets).toEqual(ticketsBefore);
  expect(fixture.records).toEqual([]);
  expect(fixture.board.changedTickets()).toEqual([]);
  return detail;
}

function inProgressReviewBarFixture(taskId: number, ticketId: string): ReturnType<typeof taskFixture> {
  return taskFixture({
    id:       taskId,
    name:     `Review 1 #${ticketId} — Example checkout page`,
    status:   'in-progress',
    start:    STARTED_AT,
    reviewOf: ticketId,
  });
}

describe('refusals', () => {
  test('a ticket a start cannot come from is refused, naming its status', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'reviewed' })] });
    expect(refusalOfAClaimOn(fixture, ['001'])).toEqual({ reason: 'unclaimable-status', ticketId: '001', status: 'reviewed' });
  });

  test('a ticket waiting on a ticket outside the claim is refused, naming what it waits on', () => {
    const fixture = boardFixture({
      tickets: [
        ticketFixture({ id: '001' }),
        ticketFixture({ id: '002', dependsOn: ['001', '009'] }),
      ],
    });
    expect(refusalOfAClaimOn(fixture, ['002'])).toEqual({ reason: 'claim-waits-on-dependencies', ticketId: '002', unsettledTicketIds: ['001', '009'] });
  });

  test('a held ticket is refused', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', hold: 'waiting on the design' })] });
    expect(refusalOfAClaimOn(fixture, ['001'])).toEqual({ reason: 'claim-of-a-held-ticket', ticketId: '001' });
  });

  test('a low ticket is refused while normal or high work is owed, naming that work', () => {
    const fixture = boardFixture({
      tickets: [
        ticketFixture({ id: '001', priority: 'low' }),
        ticketFixture({ id: '002', priority: 'high' }),
      ],
    });
    expect(refusalOfAClaimOn(fixture, ['001'])).toEqual({ reason: 'claim-of-held-back-low-ticket', ticketId: '001', holdingBackTicketIds: ['002'] });
  });

  // A reviewer at work on the ticket would find its build being redone under it, a second dispatcher run's builder among them.
  test('a ticket with a review bar in progress is refused, naming the bar', () => {
    const fixture = boardFixture({
      tasks:   [inProgressReviewBarFixture(4, '001')],
      tickets: [ticketFixture({ id: '001', status: 'in-review' })],
    });
    expect(refusalOfAClaimOn(fixture, ['001'])).toEqual({ reason: 'claim-under-review', ticketId: '001', reviewBarTaskId: 4 });
  });

  test('a claim past the limit is refused, counting the agents in flight and the rows in progress apart', () => {
    const fixture = boardFixture({
      tasks: [
        taskFixture({
          id:     1,
          status: 'in-progress',
          start:  STARTED_AT,
          agent:  '003,004',
        }),
        taskFixture({
          id:     2,
          status: 'in-progress',
          start:  STARTED_AT,
          agent:  '003,004',
        }),
      ],
      tickets:          [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })],
      concurrencyLimit: 1,
    });
    expect(refusalOfAClaimOn(fixture, ['002', '001'])).toEqual({
      reason:             'concurrency-limit-reached',
      ticketIds:          ['001', '002'],
      agentsInFlight:     1,
      inProgressRowCount: 2,
      limit:              1,
    });
  });

  test('every check of one ticket comes before the next ticket, in id order', () => {
    const fixture = boardFixture({
      tickets: [
        ticketFixture({ id: '001', hold: '' }),
        ticketFixture({ id: '002', status: 'reviewed' }),
      ],
    });
    expect(refusalOfAClaimOn(fixture, ['002', '001'])).toMatchObject({ reason: 'claim-of-a-held-ticket', ticketId: '001' });
  });

  test('every ticket\'s own checks come before a review bar is looked at, and a review bar before the limit', () => {
    const heldBehindABar = boardFixture({
      tasks:   [inProgressReviewBarFixture(4, '001')],
      tickets: [ticketFixture({ id: '001', status: 'in-review' }), ticketFixture({ id: '002', hold: '' })],
    });
    expect(refusalOfAClaimOn(heldBehindABar, ['001', '002'])).toMatchObject({ reason: 'claim-of-a-held-ticket', ticketId: '002' });

    const underReviewAtTheLimit = boardFixture({
      tasks:            [inProgressReviewBarFixture(4, '001')],
      tickets:          [ticketFixture({ id: '001', status: 'in-review' })],
      concurrencyLimit: 1,
    });
    expect(refusalOfAClaimOn(underReviewAtTheLimit, ['001'])).toMatchObject({ reason: 'claim-under-review' });
  });
});

describe('a claim that goes through', () => {
  // One agent works a bundle in dependency order, so waiting on another ticket of the same claim is no reason to refuse it.
  test('a dependency on another ticket in the claim does not refuse it', () => {
    const { board } = boardFixture({
      tickets: [
        ticketFixture({ id: '001' }),
        ticketFixture({ id: '002', dependsOn: ['001'] }),
      ],
    });
    expect(board.claimTickets(['002', '001'], {}, CLAIMED_AT).tickets.map((ticket) => ticket.frontmatter.status)).toEqual(['in-progress', 'in-progress']);
  });

  test('one ticket given twice is claimed once', () => {
    const { board, progress, records } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    const claimed                      = board.claimTickets(['001', '001'], {}, CLAIMED_AT);

    expect(claimed.tickets).toHaveLength(1);
    expect(progress.tasks).toHaveLength(1);
    expect(records.map((record) => record.kind)).toEqual(['ticket-started']);
  });

  test('every claimed row takes the key of the sorted ids, and each ticket is started in that order', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });
    const claimed = board.claimTickets(['002', '001'], {}, CLAIMED_AT);

    expect(claimed.tickets).toEqual(tickets);
    expect(progress.tasks.map((task) => [task.ticket, task.status, task.agent])).toEqual([['001', 'in-progress', '001,002'], ['002', 'in-progress', '001,002']]);
    expect(records.map((record) => [record.kind, 'ticketId' in record ? record.ticketId : null])).toEqual([['ticket-started', '001'], ['ticket-started', '002']]);
    expect(claimed.logged).toEqual(records);
  });

  test('the owner and the note given are set on every claimed row', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });
    board.claimTickets(['001', '002'], { owner: 'Example Agency builder', note: 'Example bundle build' }, CLAIMED_AT);

    expect(progress.tasks.map((task) => [task.owner, task.note])).toEqual([
      ['Example Agency builder', 'Example bundle build'],
      ['Example Agency builder', 'Example bundle build'],
    ]);
  });

  test('the concurrency comes back as it stands after the claim, the bundle counted as one agent', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })], concurrencyLimit: 3 });
    expect(board.claimTickets(['001', '002'], {}, CLAIMED_AT).concurrency).toEqual({ limit: 3, agentsInFlight: 1, freeSlots: 2 });
  });
});

/**
 * Group `checkout`, release ticket 003: 001 in review under an in-progress review bar, 002 waiting on it alone, 004 on it and on the
 * pending 007, 006 on 005 of group `payments`, 008 on nothing, and 009 on 001 outside the bundle.
 */
function pipelinedGroupFixture(concurrencyLimit: number): BoardFixture {
  return boardFixture({
    tasks: [
      taskFixture({
        id:     1,
        name:   '#001 Example checkout step',
        status: 'in-review',
        start:  STARTED_AT,
        ticket: '001',
      }),
      inProgressReviewBarFixture(2, '001'),
    ],
    tickets: [
      ticketFixture({
        id:     '001',
        status: 'in-review',
        task:   1,
        group:  'checkout',
      }),
      ticketFixture({ id: '002', group: 'checkout', dependsOn: ['001'] }),
      ticketFixture({
        id:            '003',
        group:         'checkout',
        releasesGroup: true,
        dependsOn:     ['002', '004', '006', '008'],
      }),
      ticketFixture({ id: '004', group: 'checkout', dependsOn: ['001', '007'] }),
      ticketFixture({ id: '005', status: 'in-review', group: 'payments' }),
      ticketFixture({ id: '006', group: 'checkout', dependsOn: ['005'] }),
      ticketFixture({ id: '007' }),
      ticketFixture({ id: '008', group: 'checkout' }),
      ticketFixture({ id: '009', group: 'checkout', dependsOn: ['001'] }),
    ],
    concurrencyLimit,
  });
}

describe('a claim --after a predecessor in review', () => {
  test('a plain claim of a successor whose predecessor is in review is still refused', () => {
    expect(refusalOfAClaimOn(pipelinedGroupFixture(2), ['002'])).toEqual({ reason: 'claim-waits-on-dependencies', ticketId: '002', unsettledTicketIds: ['001'] });
  });

  test('with a free slot, the in-review predecessor in the same bundle and no other unsettled dependency, the successor is claimed', () => {
    const { board, records } = pipelinedGroupFixture(2);
    const claimed            = board.claimTickets(['002'], { afterTicketId: '001' }, CLAIMED_AT);

    expect(claimed.tickets.map((ticket) => [ticket.frontmatter.id, ticket.frontmatter.status])).toEqual([['002', 'in-progress']]);
    expect(records.map((record) => record.kind)).toEqual(['ticket-started']);
    expect(claimed.concurrency).toEqual({ limit: 2, agentsInFlight: 2, freeSlots: 0 });
  });

  test('with the limit full it is refused concurrency-limit-reached and writes nothing', () => {
    expect(refusalOfAClaimOn(pipelinedGroupFixture(1), ['002'], { afterTicketId: '001' })).toEqual({
      reason:             'concurrency-limit-reached',
      ticketIds:          ['002'],
      agentsInFlight:     1,
      inProgressRowCount: 1,
      limit:              1,
    });
  });

  test('a predecessor in review in another group is refused as outside the bundle', () => {
    expect(refusalOfAClaimOn(pipelinedGroupFixture(2), ['006'], { afterTicketId: '005' }))
      .toEqual({ reason: 'claim-after-a-ticket-outside-the-bundle', ticketId: '006', afterTicketId: '005' });
  });

  test('a successor outside the release bundle is refused as outside the bundle', () => {
    expect(refusalOfAClaimOn(pipelinedGroupFixture(2), ['009'], { afterTicketId: '001' }))
      .toEqual({ reason: 'claim-after-a-ticket-outside-the-bundle', ticketId: '009', afterTicketId: '001' });
  });

  test('a predecessor that is not in review is refused, naming its status', () => {
    expect(refusalOfAClaimOn(pipelinedGroupFixture(2), ['002'], { afterTicketId: '008' })).toEqual({
      reason:        'claim-after-a-ticket-not-in-review',
      ticketId:      '002',
      afterTicketId: '008',
      status:        'pending',
    });
  });

  test('a successor that does not wait on the predecessor is refused', () => {
    const fixture = pipelinedGroupFixture(2);
    const [, , releaseTicket] = fixture.tickets;
    if (releaseTicket !== undefined) releaseTicket.frontmatter.dependsOn = ['001', '002', '004', '006', '008'];
    expect(refusalOfAClaimOn(fixture, ['008'], { afterTicketId: '001' }))
      .toEqual({ reason: 'claim-after-a-ticket-it-does-not-wait-on', ticketId: '008', afterTicketId: '001' });
  });

  test('another unsettled dependency besides the predecessor is refused, naming only that one', () => {
    expect(refusalOfAClaimOn(pipelinedGroupFixture(2), ['004'], { afterTicketId: '001' }))
      .toEqual({ reason: 'claim-waits-on-dependencies', ticketId: '004', unsettledTicketIds: ['007'] });
  });
});
