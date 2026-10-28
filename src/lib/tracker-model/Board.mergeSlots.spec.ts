/**
 * The merge slot's claim on the board. What matters: the queue is re-derived inside the hold, so a strictly higher priority queued since
 * the prediction is never jumped, a held slot is never claimed twice, and a claim writes the slot on the merge job it launches.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { MergeTargetOf }                           from './MergeSlotClaims.ts';

const AT = '2026-10-28T10:00:00+01:00';

const targetOf: MergeTargetOf = (ticket) => (ticket.group === undefined || ticket.releasesGroup === true ? 'main' : `group-${ticket.group}`);

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

function groupBoard(integratedStatus: 'in-review' | 'reviewed'): ReturnType<typeof boardFixture>['board'] {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({
        id: '010', status: integratedStatus, group: 'example', priority: 'high'
      }),
      ticketFixture({
        id: '011', status: 'reviewed', group: 'example', dependsOn: ['010']
      }),
      ticketFixture({
        id: '012', status: 'in-review', group: 'example', dependsOn: ['011'], releasesGroup: true
      }),
    ],
  });
  board.queueTicketForMerge('012', 'main', AT);
  return board;
}

describe('a group\'s release and refresh on the board', () => {
  test('the release ticket targets main only once its bundle, walked through dependsOn, integrated, carrying the bundle\'s highest priority', () => {
    expect(groupBoard('in-review').mergeCandidatesOf('main', targetOf)).toEqual([]);
    const board = groupBoard('reviewed');
    expect(board.mergeCandidatesOf('main', targetOf)).toMatchObject([{ ticketId: '012', priority: 'high' }]);
    expect(board.mergeCandidatesOf('group-example', targetOf)).toEqual([]);
    expect(board.releaseBundleTicketIdsOf('example')).toEqual(['012', '011', '010']);
  });

  test('a refresh holds the group\'s slot, so a second is refused and the release waits until it ends', () => {
    const board = groupBoard('reviewed');
    board.setTicketMergeQueued('012', false, AT);
    const { job } = board.claimRefreshSlot({
      group: 'example', target: 'group-example', targetTip: 'a'.repeat(40), mainTip: 'c'.repeat(40)
    }, AT);
    expect(job).toMatchObject({
      kind:      'refresh',
      ticketIds: [],
      state:     'merging',
      slot:      {
        target: 'group-example', targetTip: 'a'.repeat(40), branchTip: 'c'.repeat(40), phase: 'merge-in'
      }
    });
    expect(refusalDetailOf(() => board.claimRefreshSlot({
      group: 'example', target: 'group-example', targetTip: 'a'.repeat(40), mainTip: 'c'.repeat(40)
    }, AT))).toEqual({ reason: 'merge-slot-held', target: 'group-example', jobId: job.id });
    board.queueTicketForMerge('012', 'main', AT);
    expect(board.mergeCandidatesOf('main', targetOf)).toEqual([]);
    board.endJob(job.id, { outcome: 'refreshed' }, AT);
    expect(board.mergeCandidatesOf('main', targetOf).map((candidate) => candidate.ticketId)).toEqual(['012']);
  });

  test('no refresh is claimed once the group\'s release ticket is queued', () => {
    const board = groupBoard('reviewed');
    expect(refusalDetailOf(() => board.claimRefreshSlot({
      group: 'example', target: 'group-example', targetTip: 'a'.repeat(40), mainTip: 'c'.repeat(40)
    }, AT))).toEqual({ reason: 'refresh-beside-a-queued-release', group: 'example', releaseTicketId: '012' });
  });
});
