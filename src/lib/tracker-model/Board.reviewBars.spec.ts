/** Review bars are linked by `reviewOf`, never by name, and close in file order; refusals are asserted by reason code, never by wording. */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture } from '../../testing/BoardFixtures';
import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures';
import type { AgentUsage } from './@types/LogRecord';
import { TICKET_STATUSES } from './constants/Statuses';

const FILED_AT            = '2026-09-18T09:00:00+02:00';
const STARTED_AT          = '2026-09-18T10:00:00+02:00';
const FINISHED_AT         = '2026-09-18T12:00:00+02:00';
const REREVIEWED_AT       = '2026-09-18T13:00:00+02:00';
const REREVIEWED_AGAIN_AT = '2026-09-18T14:00:00+02:00';

const EXAMPLE_USAGE: AgentUsage = {
  agentId:              'agent_example',
  agentType:            'general-purpose',
  apiCallCount:         1,
  endContextTokens:     1_001,
  totalInputTokens:     1_001,
  cacheReadInputTokens: 0,
  outputTokens:         10,
};

function ticketInReviewFixture(): BoardFixture {
  return boardFixture({
    tasks: [taskFixture({
      id:     1,
      name:   '#003 Example export dialog',
      status: 'in-review',
      start:  STARTED_AT,
      end:    FINISHED_AT,
      ticket: '003',
    })],
    tickets: [ticketFixture({
      id:       '003',
      title:    'Example export dialog',
      status:   'in-review',
      started:  STARTED_AT,
      finished: FINISHED_AT,
      task:     1,
    })],
  });
}

describe('rereviewTicket', () => {
  test('a ticket already in review goes round again: the status stays, only updated moves, and the row counts the second pass', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = ticketInReviewFixture();
    const rereviewed = board.rereviewTicket('003', REREVIEWED_AT);

    expect(tickets[0]).toBe(rereviewed.ticket);
    expect(rereviewed.ticket.frontmatter).toMatchObject({ status: 'in-review', finished: FINISHED_AT, updated: REREVIEWED_AT });
    expect(progress.tasks[0]).toMatchObject({ status: 're-review', reviewRound: 2 });
    expect(progress.tasks[0]?.end, 'the bar ended when the first review began').toBe(FINISHED_AT);
    expect(records).toEqual([{
      at:       REREVIEWED_AT,
      kind:     'ticket-rereviewed',
      ticketId: '003',
      fields:   { round: 2 },
    }]);
    expect(rereviewed.logged).toEqual(records);
  });

  test('running it again on the same ticket reaches the third round and says so', () => {
    const { board, progress, records } = ticketInReviewFixture();
    board.rereviewTicket('003', REREVIEWED_AT);
    const rereviewed = board.rereviewTicket('003', REREVIEWED_AGAIN_AT);

    expect(progress.tasks[0]?.reviewRound).toBe(3);
    expect(records.at(-1)).toEqual({
      at:       REREVIEWED_AGAIN_AT,
      kind:     'ticket-rereviewed',
      ticketId: '003',
      fields:   { round: 3 },
    });
    expect(rereviewed.ticket.frontmatter.status).toBe('in-review');
  });

  test('a ticket in any other status is refused, the reason names the status it needs, and nothing moves', () => {
    for (const status of TICKET_STATUSES.filter((candidate) => candidate !== 'in-review')) {
      const {
        board,
        progress,
        tickets,
        records,
      } = boardFixture({ tickets: [ticketFixture({ id: '003', status })] });

      expect(refusalDetailOf(() => board.rereviewTicket('003', REREVIEWED_AT)), status)
        .toEqual({ reason: 'rereview-outside-review', ticketId: '003', status });
      expect(tickets[0]?.frontmatter, status).toMatchObject({ status, updated: FILED_AT });
      expect(progress.tasks, status).toEqual([]);
      expect(records, status).toEqual([]);
      expect(board.changedTickets(), status).toEqual([]);
    }
  });

  test('a ticket whose row was cleared away gets a new one in its next round rather than a refusal', () => {
    const { board, progress, records } = ticketInReviewFixture();
    progress.tasks.length              = 0;
    board.rereviewTicket('003', REREVIEWED_AT);

    expect(progress.tasks).toHaveLength(1);
    expect(progress.tasks[0]).toMatchObject({ ticket: '003', status: 're-review', reviewRound: 2 });
    expect(records.at(-1)?.fields).toEqual({ round: 2 });
  });
});

describe('startReviewBar', () => {
  test('a bar is named for the round it was given, reviews its ticket and runs from the moment it starts', () => {
    const { board, progress, records } = ticketInReviewFixture();
    const started                      = board.startReviewBar('003', { round: 2, owner: 'Example reviewer', note: 'Example review note' }, REREVIEWED_AT);

    expect(progress.tasks[1]).toBe(started.bar);
    expect(started.bar).toMatchObject({
      name:           'Review 2 #003 — Example export dialog',
      status:         'in-progress',
      start:          REREVIEWED_AT,
      reviewOf:       '003',
      reviewBarRound: 2,
      owner:          'Example reviewer',
      note:           'Example review note',
    });
    expect(started.bar.agent).toBeUndefined();
    expect(started.closedBars).toEqual([]);
    expect(records).toEqual([{
      at:       REREVIEWED_AT,
      kind:     'review-bar-started',
      taskId:   started.bar.id,
      ticketId: '003',
      fields:   { name: 'Review 2 #003 — Example export dialog' },
    }]);
  });

  // The bar's round and the row's repeat-pass count are two fields with two meanings, so a transition moves only the latter.
  test('a bar keeps the round it was filed with through a repeat review and a move back to pending', () => {
    const { board } = ticketInReviewFixture();
    const { bar }   = board.startReviewBar('003', { round: 1 }, FINISHED_AT);

    const rereviewed = board.moveTask(bar.id, 're-review', { movesAnyway: false }, REREVIEWED_AT);
    expect(rereviewed).toMatchObject({ reviewRound: 2, reviewBarRound: 1 });

    const pending = board.moveTask(bar.id, 'pending', { movesAnyway: false }, REREVIEWED_AGAIN_AT);
    expect(pending.reviewBarRound).toBe(1);
    expect('reviewRound' in pending).toBe(false);
  });

  // A bundle is one agent: its reviewer shares the builder's slot while the claim's other tickets are still being built.
  test('a bar takes its claim\'s agent key while another row of that claim is in progress, and none once the claim is done', () => {
    const inBundle = boardFixture({
      tasks: [
        taskFixture({
          id:     1,
          status: 'in-review',
          ticket: '003',
          agent:  '003,004',
        }),
        taskFixture({
          id:     2,
          status: 'in-progress',
          ticket: '004',
          agent:  '003,004',
        }),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review', task: 1 }), ticketFixture({ id: '004', status: 'in-progress', task: 2 })],
    });
    expect(inBundle.board.startReviewBar('003', { round: 1 }, REREVIEWED_AT).bar.agent).toBe('003,004');

    const claimDone = boardFixture({
      tasks: [
        taskFixture({
          id:     1,
          status: 'in-review',
          ticket: '003',
          agent:  '003,004',
        }),
        taskFixture({
          id:     2,
          status: 'in-review',
          ticket: '004',
          agent:  '003,004',
        }),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review', task: 1 }), ticketFixture({ id: '004', status: 'in-review', task: 2 })],
    });
    expect(claimDone.board.startReviewBar('003', { round: 1 }, REREVIEWED_AT).bar.agent).toBeUndefined();
  });

  test('the ticket\'s earlier bar is finished and delivered before the next one starts', () => {
    const { board, progress, records } = ticketInReviewFixture();
    const first                        = board.startReviewBar('003', { round: 1 }, FINISHED_AT);
    const second                       = board.startReviewBar('003', { round: 2 }, REREVIEWED_AT);

    expect(second.closedBars.map((bar) => bar.id)).toEqual([first.bar.id]);
    expect(progress.tasks.find((task) => task.id === first.bar.id)).toMatchObject({ status: 'delivered', end: REREVIEWED_AT });
    expect(records.slice(1).map((record) => [record.kind, 'taskId' in record ? record.taskId : null])).toEqual([
      ['review-bar-closed', first.bar.id],
      ['review-bar-started', second.bar.id],
    ]);
    expect(second.logged).toEqual(records.slice(1));
  });

  // The Board reads no name; ingestion gives a legacy bar its `reviewOf` from its name before the Board sees it.
  test('a record without reviewOf is never closed, whatever its name says', () => {
    const { board, progress } = ticketInReviewFixture();
    progress.tasks.push(taskFixture({ id: 2, name: 'Review 1 #003 — Example export dialog', status: 'in-progress' }));
    const started = board.startReviewBar('003', { round: 2 }, REREVIEWED_AT);

    expect(started.closedBars).toEqual([]);
    expect(progress.tasks.find((task) => task.id === 2)?.status).toBe('in-progress');
  });
});

// `task add --review-of` on a row a ticket owns stores `reviewOf` on it. Closing and the claim refusal read `reviewOf` on any row, while
// the page and hook queries read only free-standing rows.
describe('a row a ticket owns that also stores reviewOf', () => {
  const OWNED_ROW_ID         = 2;
  const FREE_STANDING_BAR_ID = 3;

  function ownedRowReviewingFixture(aFreeStandingBarIsFiled: boolean): BoardFixture {
    const fixture = ticketInReviewFixture();
    fixture.tickets.push(ticketFixture({ id: '004', title: 'Example follow-up' }));
    fixture.board.addTask({
      name:         '#004 Example follow-up',
      ticketId:     '004',
      reviewOf:     { ticketId: '003', round: 1 },
      startsNow:    true,
      movesTheLink: false,
    }, STARTED_AT);
    if (aFreeStandingBarIsFiled) {
      fixture.board.addTask({
        name:         'Review 1 #003 — Example export dialog',
        reviewOf:     { ticketId: '003', round: 1 },
        startsNow:    true,
        movesTheLink: false,
      }, STARTED_AT);
    }
    fixture.records.length = 0;
    return fixture;
  }

  function closedTaskIdsOf(records: BoardFixture['records']): number[] {
    return records.flatMap((record) => (record.kind === 'review-bar-closed' && 'taskId' in record ? [record.taskId] : []));
  }

  test('a move out of review delivers it with the free-standing bar and logs a closure for each', () => {
    const { board, progress, records } = ownedRowReviewingFixture(true);
    board.moveTicket('003', 'reviewed', { checksLegality: true }, REREVIEWED_AT);

    expect(progress.tasks.find((task) => task.id === OWNED_ROW_ID)?.status).toBe('delivered');
    expect(progress.tasks.find((task) => task.id === FREE_STANDING_BAR_ID)?.status).toBe('delivered');
    expect(closedTaskIdsOf(records)).toEqual([OWNED_ROW_ID, FREE_STANDING_BAR_ID]);
  });

  test('starting the next review bar closes it with the free-standing bar', () => {
    const { board, progress } = ownedRowReviewingFixture(true);
    const started             = board.startReviewBar('003', { round: 2 }, REREVIEWED_AT);

    expect(started.closedBars.map((bar) => bar.id)).toEqual([OWNED_ROW_ID, FREE_STANDING_BAR_ID]);
    expect(progress.tasks.find((task) => task.id === OWNED_ROW_ID)?.status).toBe('delivered');
  });

  test('a release closes and delivers it with the free-standing bar, and logs a closure for each', () => {
    const { board, progress, records } = ownedRowReviewingFixture(true);
    const released                     = board.releaseTickets(['003'], { branch: 'ticket/example-export', commit: 'a1b2c3d4e5f6' }, REREVIEWED_AT);

    expect(released.closedReviewBars.map((bar) => bar.id)).toEqual([OWNED_ROW_ID, FREE_STANDING_BAR_ID]);
    expect(progress.tasks.find((task) => task.id === OWNED_ROW_ID)?.status).toBe('delivered');
    expect(progress.tasks.find((task) => task.id === FREE_STANDING_BAR_ID)?.status).toBe('delivered');
    expect(closedTaskIdsOf(records)).toEqual([OWNED_ROW_ID, FREE_STANDING_BAR_ID]);
  });

  test('a claim of the reviewed ticket is refused because of it, naming it', () => {
    const { board } = ownedRowReviewingFixture(false);

    expect(refusalDetailOf(() => board.claimTickets(['003'], { owner: 'Alex Example' }, REREVIEWED_AT)))
      .toEqual({ reason: 'claim-under-review', ticketId: '003', reviewBarTaskId: OWNED_ROW_ID });
  });

  test('a claim of the reviewed ticket with the free-standing bar in progress too names it, the oldest', () => {
    const { board } = ownedRowReviewingFixture(true);

    expect(refusalDetailOf(() => board.claimTickets(['003'], { owner: 'Alex Example' }, REREVIEWED_AT)))
      .toEqual({ reason: 'claim-under-review', ticketId: '003', reviewBarTaskId: OWNED_ROW_ID });
  });

  test('the ticket\'s review bars leave it out, and a review share goes to the free-standing bar, never to it', () => {
    const { board, progress } = ownedRowReviewingFixture(true);

    expect(board.reviewBarsOf('003').map((bar) => bar.id)).toEqual([FREE_STANDING_BAR_ID]);
    const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'review', ticketId: '003', tokens: 1_001 }], REREVIEWED_AT);
    expect(outcomes).toEqual([{ verdict: 'credited', taskId: FREE_STANDING_BAR_ID }]);
    expect(progress.tasks.find((task) => task.id === OWNED_ROW_ID)?.tokens ?? null).toBeNull();
  });
});

describe('in-progress review bars stored out of id order', () => {
  function barsOutOfIdOrderFixture(): BoardFixture {
    const fixture = ticketInReviewFixture();
    fixture.progress.tasks.push(
      taskFixture({
        id:       8,
        name:     'Review 2 #003 — Example export dialog',
        status:   'in-progress',
        reviewOf: '003',
      }),
      taskFixture({
        id:       4,
        name:     'Review 1 #003 — Example export dialog',
        status:   'in-progress',
        reviewOf: '003',
      }),
    );
    return fixture;
  }

  test('a claim of the ticket is refused naming the first bar in the file', () => {
    const { board } = barsOutOfIdOrderFixture();

    expect(refusalDetailOf(() => board.claimTickets(['003'], { owner: 'Alex Example' }, REREVIEWED_AT)))
      .toEqual({ reason: 'claim-under-review', ticketId: '003', reviewBarTaskId: 8 });
  });

  test('the move that ends the review closes them in file order and logs them in that order', () => {
    const { board, records } = barsOutOfIdOrderFixture();
    const moved              = board.moveTicket('003', 'reviewed', { checksLegality: true }, REREVIEWED_AT);

    expect(moved.closedReviewBars.map((bar) => bar.id)).toEqual([8, 4]);
    expect(records.flatMap((record) => (record.kind === 'review-bar-closed' && 'taskId' in record ? [record.taskId] : []))).toEqual([8, 4]);
  });
});
