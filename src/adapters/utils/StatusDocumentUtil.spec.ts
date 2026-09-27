/**
 * The fields `status --json` carries for a dispatcher. What its readers rely on: the keys come in a fixed order, since they are appended
 * to a document whose order is a contract; every model, effort and priority is resolved to its default, so a reader copies rather than
 * fills them; a paused build carries its row's note whoever paused it; and `ticketRows` follows the tickets it is handed, with the
 * ticket's linked row and its review bars oldest filed first, a round only where the bar stores one.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import { StatusDocumentUtil }                       from './StatusDocumentUtil.ts';

const { inProgressIdsOf, boardWorkOf } = StatusDocumentUtil;

describe('the key order', () => {
  test('is the ids of tickets, then of reviews, in flight', () => {
    const { board } = boardFixture();

    expect(Object.keys(inProgressIdsOf(board))).toEqual(['inProgressTicketIds', 'inProgressReviewOfIds']);
  });

  test('is the reviews waiting, the paused builds, then the ticket rows', () => {
    const { board } = boardFixture();

    expect(Object.keys(boardWorkOf(board, []))).toEqual(['reviewWaitingTickets', 'pausedBuilds', 'ticketRows']);
  });
});

test('the ids in flight are the Board\'s own answers', () => {
  const { board } = boardFixture({
    tasks: [
      taskFixture({ id: 1, status: 'in-progress', ticket: '001' }),
      taskFixture({
        id:             2,
        status:         'in-progress',
        reviewOf:       '002',
        reviewBarRound: 1,
      }),
    ],
  });

  expect(inProgressIdsOf(board)).toEqual({ inProgressTicketIds: ['001'], inProgressReviewOfIds: ['002'] });
});

describe('the reviews waiting and the paused builds', () => {
  test('resolve every model, effort and priority a ticket leaves out to its default', () => {
    const { board, tickets } = boardFixture({
      tasks: [taskFixture({
        id:     1,
        status: 'paused',
        ticket: '002',
        note:   'Paused by Alex Example',
      })],
      tickets: [ticketFixture({ id: '001', status: 'in-review' }), ticketFixture({ id: '002', status: 'in-progress', task: 1 })],
    });

    const work = boardWorkOf(board, tickets);

    expect(work.reviewWaitingTickets).toEqual([{ id: '001', model: 'opus', effort: 'medium' }]);
    expect(work.pausedBuilds).toEqual([{
      id:       '002',
      note:     'Paused by Alex Example',
      priority: 'normal',
      model:    'opus',
      effort:   'medium',
    }]);
  });

  test('carry the model, effort and priority a ticket names', () => {
    const { board, tickets } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'paused', ticket: '002' })],
      tickets: [
        ticketFixture({
          id:     '001',
          status: 'in-review',
          model:  'sonnet',
          effort: 'high',
        }),
        ticketFixture({
          id:       '002',
          status:   'in-progress',
          task:     1,
          priority: 'high',
          model:    'haiku',
          effort:   'low',
        }),
      ],
    });

    const work = boardWorkOf(board, tickets);

    expect(work.reviewWaitingTickets).toEqual([{ id: '001', model: 'sonnet', effort: 'high' }]);
    expect(work.pausedBuilds).toEqual([{
      id:       '002',
      note:     '',
      priority: 'high',
      model:    'haiku',
      effort:   'low',
    }]);
  });

  // A person's pause is a pause too: which run owns it is the reader's to judge from the note, so it is listed with whatever note it has.
  test('list a build paused by hand with its note, beside one a dispatcher paused', () => {
    const { board, tickets } = boardFixture({
      tasks: [
        taskFixture({
          id:     1,
          status: 'paused',
          ticket: '001',
          note:   'Claimed by the example dispatcher run',
        }),
        taskFixture({
          id:     2,
          status: 'paused',
          ticket: '002',
          note:   'Waiting on Example Agency',
        }),
      ],
      tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 }), ticketFixture({ id: '002', status: 'in-progress', task: 2 })],
    });

    expect(boardWorkOf(board, tickets).pausedBuilds.map((build) => [build.id, build.note])).toEqual([
      ['001', 'Claimed by the example dispatcher run'],
      ['002', 'Waiting on Example Agency'],
    ]);
  });

  test('leave out a paused row whose ticket is no longer in progress', () => {
    const { board, tickets } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'paused', ticket: '001' })],
      tickets: [ticketFixture({ id: '001', status: 'in-review', task: 1 })],
    });

    expect(boardWorkOf(board, tickets).pausedBuilds).toEqual([]);
  });
});

describe('the ticket rows', () => {
  test('follow the listed tickets\' order and give a ticket without a row null', () => {
    const { board, tickets } = boardFixture({
      tasks: [taskFixture({
        id:     1,
        status: 'in-progress',
        ticket: '001',
        note:   'Building',
      })],
      tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 }), ticketFixture({ id: '002' })],
    });
    const [first, second] = tickets;
    if (first === undefined || second === undefined) throw new Error('The fixture holds two tickets.');

    expect(boardWorkOf(board, [second, first]).ticketRows).toEqual([
      { id: '002', row: null, reviewBars: [] },
      { id: '001', row: { id: 1, status: 'in-progress', note: 'Building' }, reviewBars: [] },
    ]);
  });

  test('cover only the tickets listed', () => {
    const { board, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });

    expect(boardWorkOf(board, tickets.slice(1)).ticketRows.map((entry) => entry.id)).toEqual(['002']);
  });

  test('list the bars oldest filed first, with the round a bar stores and none where it stores none', () => {
    const { board, tickets } = boardFixture({
      tasks: [
        taskFixture({
          id:     1,
          status: 'in-review',
          ticket: '001',
          note:   'Built',
        }),
        taskFixture({
          id:             5,
          status:         'in-progress',
          reviewOf:       '001',
          reviewBarRound: 2,
        }),
        taskFixture({ id: 3, status: 'delivered', reviewOf: '001' }),
      ],
      tickets: [ticketFixture({ id: '001', status: 'in-review', task: 1 })],
    });

    const [entry] = boardWorkOf(board, tickets).ticketRows;

    // Strict, so a `round: undefined` key on the first bar would fail it.
    expect(entry?.reviewBars).toStrictEqual([{ id: 3, status: 'delivered' }, { id: 5, status: 'in-progress', round: 2 }]);
  });

  // A reviewer taking over a bar and a parking agent closing one read these, so they must count the rows a claim and a move out of review do.
  test('list a row another ticket owns that stores reviewOf among the bars, as it keeps its ticket from waiting on a review', () => {
    const { board, tickets } = boardFixture({
      tasks: [
        taskFixture({ id: 1, status: 'in-review', ticket: '001' }),
        taskFixture({
          id: 2, status: 'in-progress', ticket: '002', reviewOf: '001', reviewBarRound: 1
        }),
      ],
      tickets: [ticketFixture({ id: '001', status: 'in-review', task: 1 }), ticketFixture({ id: '002', status: 'in-progress', task: 2 })],
    });

    const work = boardWorkOf(board, tickets);

    expect(work.ticketRows).toEqual([
      { id: '001', row: { id: 1, status: 'in-review', note: '' }, reviewBars: [{ id: 2, status: 'in-progress', round: 1 }] },
      { id: '002', row: { id: 2, status: 'in-progress', note: '' }, reviewBars: [] },
    ]);
    expect(work.reviewWaitingTickets).toEqual([]);
  });
});
