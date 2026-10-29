/**
 * The merge queue's facts in `BoardState`, which the Bridge's Merge queue detail shows without ordering anything itself. What matters: each
 * target lists its waiting candidates in the five-key order from git's predictions, with the conflicts each causes; the Airlock holder and
 * its phase; the open `target-moved` decisions of the target's tickets; and a reading without forecasting leaves the targets empty.
 */
import { describe, expect, test } from 'bun:test';

import type { MergeTargetOf }                        from '../../lib/tracker-model/MergeSlotClaims.ts';
import { boardFixture, ticketFixture }               from '../../testing/BoardFixtures.ts';
import { BoardStateAssembly, type MergeForecasting } from './BoardState.ts';

const AT = '2026-10-28T10:00:00+01:00';

const targetOf: MergeTargetOf = (ticket) => (ticket.group === undefined || ticket.releasesGroup === true ? 'main' : `group-${ticket.group}`);

function queuedBoard(): ReturnType<typeof boardFixture>['board'] {
  const { board } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', status: 'in-review' }),
      ticketFixture({ id: '002', status: 'in-review' }),
      ticketFixture({ id: '003', status: 'in-review', priority: 'high' }),
      ticketFixture({ id: '004', status: 'in-review' }),
    ],
  });
  for (const ticketId of ['001', '002', '003', '004']) board.queueTicketForMerge(ticketId, 'main', AT);
  return board;
}

/** 001 conflicts with main; 002 and 004 are clean but conflict with each other, and 004 also with 003. */
const FORECASTING: MergeForecasting = {
  targetOf,
  forecastsOf: (_target, ticketIds) => ({
    againstTarget: Object.fromEntries(ticketIds.map((ticketId) => [ticketId, ticketId === '001'
      ? { forecast: 'conflicting' as const, conflictedFiles: ['src/Example.ts'] }
      : { forecast: 'clean' as const, conflictedFiles: [] }])),
    pairwiseConflicts: [['002', '004'], ['003', '004']],
  }),
};

describe('BoardStateAssembly.mergeQueueOf', () => {
  test('orders a target\'s candidates by priority, clean first, fewest conflicts caused, then readiness', () => {
    const { targets } = BoardStateAssembly.mergeQueueOf(queuedBoard(), FORECASTING);
    expect(targets.map((target) => target.target)).toEqual(['main']);
    expect(targets[0]?.order.map((entry) => [entry.ticketId, entry.againstTarget, entry.conflictsCaused])).toEqual([
      ['003', 'clean', 1], ['002', 'clean', 1], ['004', 'clean', 2], ['001', 'conflicting', 0],
    ]);
    expect(targets[0]?.order[3]?.conflictedFiles).toEqual(['src/Example.ts']);
    expect(targets[0]?.holder).toBeNull();
  });

  test('names the Airlock holder with its phase and the target-moved decisions of the target\'s tickets', () => {
    const board = queuedBoard();
    const { job } = board.claimMergeSlot({
      ticketId: '003', target: 'main', targetTip: 'a'.repeat(40), branchTip: 'b'.repeat(40), predictedConflictFiles: []
    }, targetOf, AT);
    board.openDecision({
      kind:      'target-moved',
      ticketIds: ['002'],
      jobId:     null,
      askedBy:   'runner',
      requestId: null,
      questions: [{
        question: 'Example?', header: 'Example', multiSelect: false, options: []
      }],
      context: 'main moved'
    }, AT);
    const [target] = BoardStateAssembly.mergeQueueOf(board, FORECASTING).targets;
    expect(target?.holder).toEqual({ jobId: job.id, ticketIds: ['003'], phase: 'merge-in' });
    expect(target?.targetMovedDecisionIds).toEqual(['E1']);
  });

  test('a reading without forecasting leaves the targets empty and keeps the queued tickets', () => {
    expect(BoardStateAssembly.mergeQueueOf(queuedBoard(), null)).toEqual({ queuedTicketIds: ['001', '002', '003', '004'], slots: [], targets: [] });
  });
});
