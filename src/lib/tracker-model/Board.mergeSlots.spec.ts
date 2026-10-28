/**
 * The merge slot's claim on the board. What matters: the queue is re-derived inside the hold, so a strictly higher priority queued since
 * the prediction is never jumped, a held slot is never claimed twice, and a claim writes the slot on the merge job it launches.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';

const AT = '2026-10-28T10:00:00+01:00';

const targetOf = (group: string | undefined): string => (group === undefined ? 'main' : `group-${group}`);

function queuedBoard(): ReturnType<typeof boardFixture>['board'] {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'in-review' }),
      ticketFixture({ id: '002', status: 'in-review', priority: 'high' }),
      ticketFixture({ id: '003', status: 'in-review', priority: 'low' }),
    ],
  });
  for (const ticketId of ['001', '002', '003']) board.queueTicketForMerge(ticketId, 'main', AT);
  return board;
}

function claimOf(ticketId: string): Parameters<ReturnType<typeof boardFixture>['board']['claimMergeSlot']>[0] {
  return {
    ticketId, target: 'main', targetTip: 'a'.repeat(40), branchTip: 'b'.repeat(40), predictedConflictFiles: []
  };
}

describe('claiming the main line\'s merge slot', () => {
  test('refuses higher-priority-queued while a strictly higher priority candidate waits, naming it', () => {
    const board = queuedBoard();
    expect(refusalDetailOf(() => board.claimMergeSlot(claimOf('001'), targetOf, AT))).toEqual({ reason: 'higher-priority-queued', ticketId: '001', queuedTicketIds: ['002'] });
  });

  test('takes the highest priority, writing the slot in its merge-in phase on the merge job it launches', () => {
    const board = queuedBoard();
    const { job } = board.claimMergeSlot(claimOf('002'), targetOf, AT);
    expect(job).toMatchObject({
      kind:      'merge',
      state:     'merging',
      ticketIds: ['002'],
      slot:      {
        target: 'main', targetTip: 'a'.repeat(40), branchTip: 'b'.repeat(40), phase: 'merge-in'
      }
    });
  });

  test('refuses merge-slot-held while a merge job holds the target, and a ticket not queued', () => {
    const board = queuedBoard();
    const { job } = board.claimMergeSlot(claimOf('002'), targetOf, AT);
    expect(refusalDetailOf(() => board.claimMergeSlot(claimOf('001'), targetOf, AT))).toEqual({ reason: 'merge-slot-held', target: 'main', jobId: job.id });
    board.endJob(job.id, { outcome: 'landed' }, AT);
    board.setTicketMergeQueued('002', false, AT);
    expect(refusalDetailOf(() => board.claimMergeSlot(claimOf('002'), targetOf, AT))).toEqual({ reason: 'merge-candidate-not-queued', ticketId: '002', target: 'main' });
  });

  test('a candidate with a merge job of its own, or a landing-refused decision, is no candidate', () => {
    const board = queuedBoard();
    board.openDecision({
      kind:      'landing-refused',
      ticketIds: ['002'],
      jobId:     null,
      askedBy:   'runner',
      requestId: null,
      questions: [{
        question: 'Example?', header: 'Example', multiSelect: false, options: []
      }],
      context: 'acceptance-unaccounted'
    }, AT);
    expect(board.mergeCandidatesOf('main', targetOf).map((candidate) => candidate.ticketId)).toEqual(['001', '003']);
  });
});
