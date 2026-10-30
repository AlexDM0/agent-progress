/**
 * The Merge queue detail's model. What matters: the order is the Overseer's, kept as it arrives; the Airlock holder reads with its phase;
 * each candidate's prediction and the pairwise conflicts are worded; and a target's landings name the `target-moved` decision and the
 * `dirty-main-checkout` notice they wait on, including a target that has nothing queued.
 */
import { describe, expect, test } from 'bun:test';

import { DIRTY_CHECKOUT_NOTICE, QUEUED_TARGET } from '../../testing/BoardStateFixture.ts';
import { MergeQueueModel }                      from './MergeQueueModel.ts';

describe('a queued target', () => {
  const [target] = MergeQueueModel.mergeQueueModelOf({ targets: [QUEUED_TARGET] }, [DIRTY_CHECKOUT_NOTICE]);

  test('keeps the Overseer\'s five-key order and words each prediction', () => {
    expect(target?.lines).toEqual([
      {
        position: 1, ticketId: '8', priority: 'high', forecast: 'clean', forecastText: 'clean', causesText: 'would conflict with 1 clean candidate'
      },
      {
        position: 2, ticketId: '9', priority: 'normal', forecast: 'conflicting', forecastText: 'conflicts in src/Example.ts', causesText: null
      },
    ]);
  });

  test('names the Airlock holder and its phase, the pairwise conflicts, and what its landings wait on', () => {
    expect([target?.holderText, target?.phase]).toEqual(['J12 for #7 holds the Airlock: gating', 'gating']);
    expect(target?.pairwiseTexts).toEqual(['#8 and #10 conflict with each other']);
    expect(target?.waitingReasons).toEqual([
      'landings wait on the target-moved decision E4',
      'landings wait: the main checkout\'s changes to README.md block the fast-forward',
    ]);
  });
});

describe('a target only a notice names', () => {
  test('shows with a free Airlock and the reason its landings wait', () => {
    expect(MergeQueueModel.mergeQueueModelOf(undefined, [{ ...DIRTY_CHECKOUT_NOTICE, target: 'group-example', blockingFiles: [] }])).toEqual([{
      target:         'group-example',
      holderText:     'Airlock free',
      phase:          null,
      lines:          [],
      pairwiseTexts:  [],
      waitingReasons: ['landings wait: the main checkout is on main'],
    }]);
  });

  test('a failed prediction reads as failed', () => {
    expect(MergeQueueModel.forecastTextOf({
      ticketId: '1', priority: 'low', againstTarget: 'prediction-failed', conflictedFiles: null, conflictsCaused: 0
    })).toBe('prediction failed');
  });
});
