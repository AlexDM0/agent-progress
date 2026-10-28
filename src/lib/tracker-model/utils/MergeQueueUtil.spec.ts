/**
 * The merge queue's order and the group refresh's trigger. What matters is that each of the five keys decides only when every key above it
 * ties, that a failed prediction orders as conflicting, that only clean candidates count as conflicts caused, and that no tie-break ever
 * lifts a lower priority over a higher. A refresh is due by the count or by a conflicting group tip, and never beside a queued release.
 */
import { describe, expect, test } from 'bun:test';

import {
  MergeQueueUtil,
  type GroupRefreshFacts,
  type MergeQueueCandidate,
  type PairwiseConflict
} from './MergeQueueUtil.ts';

function candidate(ticketId: string, overrides: Partial<MergeQueueCandidate> = {}): MergeQueueCandidate {
  return {
    ticketId, priority: 'normal', againstTarget: 'clean', queuedLogPosition: 0, ...overrides
  };
}

function orderedIdsOf(candidates: readonly MergeQueueCandidate[], pairwiseConflicts: readonly PairwiseConflict[] = []): string[] {
  return MergeQueueUtil.orderOf(candidates, pairwiseConflicts).map((ordered) => ordered.ticketId);
}

describe('ordering the merge queue', () => {
  const cases: { claim: string; candidates: MergeQueueCandidate[]; pairwiseConflicts?: PairwiseConflict[]; expected: string[] }[] = [
    {
      claim:      'priority comes first, high before normal before low',
      candidates: [candidate('1', { priority: 'low' }), candidate('2', { priority: 'high' }), candidate('3')],
      expected:   ['2', '3', '1'],
    },
    {
      claim:      'within a priority a clean candidate comes before a conflicting one, and a failed prediction orders as conflicting',
      candidates: [
        candidate('1', { againstTarget: 'conflicting' }),
        candidate('2', { againstTarget: 'prediction-failed', queuedLogPosition: -1 }),
        candidate('3', { queuedLogPosition: 9 }),
      ],
      expected: ['3', '2', '1'],
    },
    {
      claim:             'among clean candidates the one causing fewer conflicts with the other clean candidates comes first',
      candidates:        [candidate('1'), candidate('2', { queuedLogPosition: 1 }), candidate('3', { queuedLogPosition: 2 })],
      pairwiseConflicts: [['1', '2'], ['3', '1']],
      expected:          ['2', '3', '1'],
    },
    {
      claim:             'a conflict with a candidate that is itself conflicting against the target is not counted as caused',
      candidates:        [candidate('1'), candidate('2', { queuedLogPosition: 1 }), candidate('3', { againstTarget: 'conflicting' })],
      pairwiseConflicts: [['1', '3']],
      expected:          ['1', '2', '3'],
    },
    {
      claim:      'readiness, the log position of the merge-queued record, breaks a tie on every key above it',
      candidates: [candidate('1', { queuedLogPosition: 7 }), candidate('2', { queuedLogPosition: 3 })],
      expected:   ['2', '1'],
    },
    {
      claim:      'the ticket id, read as a number, breaks the last tie',
      candidates: [candidate('10'), candidate('9'), candidate('100')],
      expected:   ['9', '10', '100'],
    },
    {
      claim:             'a low-priority clean candidate causing no conflict never orders before a high-priority conflicting one queued later',
      candidates:        [candidate('1', { priority: 'low' }), candidate('2', { priority: 'high', againstTarget: 'conflicting', queuedLogPosition: 5 })],
      pairwiseConflicts: [['2', '1']],
      expected:          ['2', '1'],
    },
  ];
  for (const {
    claim, candidates, pairwiseConflicts, expected
  } of cases) {
    test(claim, () => {
      expect(orderedIdsOf(candidates, pairwiseConflicts)).toEqual(expected);
    });
  }

  test('no ordering of any candidate set puts a lower priority before a higher', () => {
    const priorities = ['high', 'normal', 'low'] as const;
    const forecasts  = ['clean', 'conflicting', 'prediction-failed'] as const;
    const candidates = [...Array.from({ length: 27 }).keys()].map((i) => candidate(String(i + 1), {
      priority:          priorities[i % 3] ?? 'normal',
      againstTarget:     forecasts[Math.floor(i / 3) % 3] ?? 'clean',
      queuedLogPosition: 27 - i,
    }));
    const pairwiseConflicts: PairwiseConflict[] = candidates.flatMap((first, i) => (i % 2 === 0 ? [[first.ticketId, String(((i * 7) % 27) + 1)] as const] : []));
    const rankOf = { high: 0, normal: 1, low: 2 } as const;
    const ranks  = MergeQueueUtil.orderOf(candidates, pairwiseConflicts).map((ordered) => rankOf[ordered.priority]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test('the order is a new list and leaves the candidates as they were', () => {
    const candidates = [candidate('2'), candidate('1')];
    MergeQueueUtil.orderOf(candidates, []);
    expect(candidates.map((unordered) => unordered.ticketId)).toEqual(['2', '1']);
  });

  test('the conflicts caused count only other candidates clean against the target, in either pair order, whatever the counted one is', () => {
    const candidates = [candidate('1'), candidate('2'), candidate('3'), candidate('4', { againstTarget: 'conflicting' })];
    const pairwiseConflicts: PairwiseConflict[] = [['1', '2'], ['3', '1'], ['1', '4'], ['2', '3']];
    expect(candidates.map((counted) => MergeQueueUtil.conflictsCausedBy(counted, candidates, pairwiseConflicts))).toEqual([2, 2, 2, 1]);
  });
});

describe('when a group refresh is due', () => {
  const limits = { GROUP_REFRESH_AFTER_MAIN_COMMITS: 30 };
  const quiet: GroupRefreshFacts = { mainCommitsAheadOfGroup: 29, groupTipAgainstMain: 'clean', releaseTicketIsQueuedOrSlotted: false };

  const cases: { claim: string; facts: GroupRefreshFacts; due: boolean }[] = [
    { claim: 'not while main is under the limit ahead and the group tip merges cleanly', facts: quiet, due: false },
    { claim: 'once main is the limit ahead of the group', facts: { ...quiet, mainCommitsAheadOfGroup: 30 }, due: true },
    { claim: 'once the group tip is predicted to conflict with main', facts: { ...quiet, groupTipAgainstMain: 'conflicting' }, due: true },
    { claim: 'once the prediction of the group tip against main failed, read as conflicting', facts: { ...quiet, groupTipAgainstMain: 'prediction-failed' }, due: true },
    { claim: 'not by the count when git could not count', facts: { ...quiet, mainCommitsAheadOfGroup: null }, due: false },
    {
      claim: 'never once the release ticket is queued or slotted, however far main is ahead',
      facts: { mainCommitsAheadOfGroup: 500, groupTipAgainstMain: 'conflicting', releaseTicketIsQueuedOrSlotted: true },
      due:   false,
    },
  ];
  for (const { claim, facts, due } of cases) {
    test(claim, () => {
      expect(MergeQueueUtil.groupRefreshIsDue(facts, limits)).toBe(due);
    });
  }

  test('the limit is the one passed, not a built-in number', () => {
    expect(MergeQueueUtil.groupRefreshIsDue({ ...quiet, mainCommitsAheadOfGroup: 3 }, { GROUP_REFRESH_AFTER_MAIN_COMMITS: 3 })).toBe(true);
    expect(MergeQueueUtil.groupRefreshIsDue({ ...quiet, mainCommitsAheadOfGroup: 3 }, { GROUP_REFRESH_AFTER_MAIN_COMMITS: 4 })).toBe(false);
  });
});
