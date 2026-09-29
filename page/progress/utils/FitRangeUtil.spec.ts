/**
 * The Fit range. The cases that matter: under each finished-work choice Fit starts at the earliest start among the rows that choice
 * shows minus the margin, and ends at now plus the same margin; the margin is a share of the span with a floor; and a chart with no
 * started row still spans its margin around now.
 */

import { describe, expect, test }  from 'bun:test';
import type { Task }               from '../../../src/lib/tracker-model/@types/Task.ts';
import type { FinishedWorkChoice } from '../../@types/ViewerChoices.ts';
import { EXAMPLE_PAGE_LIMITS }     from '../../testing/PageLimitsFixture.ts';
import { FinishedWorkUtil }        from '../../utils/FinishedWorkUtil.ts';
import { FitRangeUtil }            from './FitRangeUtil.ts';

const { fittedSpanOf, fitMarginMillisecondsOf } = FitRangeUtil;

const MINUTE_MILLISECONDS    = 60_000;
const HOUR_MILLISECONDS      = 60 * MINUTE_MILLISECONDS;
const DAY_MILLISECONDS       = 24 * HOUR_MILLISECONDS;
const NOW_EPOCH_MILLISECONDS = new Date(2026, 8, 25, 13, 36).getTime();

function exampleTask(id: number, startedBefore: number, finishedBefore: number | null): Task {
  return {
    id,
    name:   `Example task ${id}`,
    status: finishedBefore === null ? 'in-progress' : 'delivered',
    start:  new Date(NOW_EPOCH_MILLISECONDS - startedBefore).toISOString(),
    end:    finishedBefore === null ? null : new Date(NOW_EPOCH_MILLISECONDS - finishedBefore).toISOString(),
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
  };
}

const BOARD_TASKS: readonly Task[] = [
  exampleTask(1, 2 * HOUR_MILLISECONDS, 30 * MINUTE_MILLISECONDS),
  exampleTask(2, 7 * HOUR_MILLISECONDS, 5 * HOUR_MILLISECONDS),
  exampleTask(3, 2 * DAY_MILLISECONDS + 4 * HOUR_MILLISECONDS, 2 * DAY_MILLISECONDS),
  exampleTask(4, 6 * DAY_MILLISECONDS, 5 * DAY_MILLISECONDS),
  exampleTask(5, 45 * MINUTE_MILLISECONDS, null),
];

function visibleTasksUnder(choice: FinishedWorkChoice): Task[] {
  const cutoff = FinishedWorkUtil.cutoffEpochMillisecondsOf(choice, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
  return BOARD_TASKS.filter((task) => FinishedWorkUtil.finishedMomentIsShown(FinishedWorkUtil.taskFinishedEpochMillisecondsOf(task), cutoff));
}

describe('Fit under each finished-work choice', () => {
  const EARLIEST_VISIBLE_START_BEFORE: readonly (readonly [FinishedWorkChoice, number])[] = [
    ['1h', 2 * HOUR_MILLISECONDS],
    ['1d', 7 * HOUR_MILLISECONDS],
    ['3d', 2 * DAY_MILLISECONDS + 4 * HOUR_MILLISECONDS],
    ['all', 6 * DAY_MILLISECONDS],
  ];

  for (const [choice, startedBefore] of EARLIEST_VISIBLE_START_BEFORE) {
    test(`${choice}: starts at the earliest visible start minus the margin and ends at now plus it`, () => {
      const earliestStart = NOW_EPOCH_MILLISECONDS - startedBefore;
      const margin        = Math.max(5 * MINUTE_MILLISECONDS, startedBefore * 0.03);
      const span          = fittedSpanOf(visibleTasksUnder(choice), NOW_EPOCH_MILLISECONDS);

      expect(span.earliestStartEpochMilliseconds).toBe(earliestStart);
      expect(span.marginMilliseconds).toBe(margin);
      expect(span.fromEpochMilliseconds).toBe(earliestStart - margin);
      expect(span.toEpochMilliseconds).toBe(NOW_EPOCH_MILLISECONDS + margin);
    });
  }
});

describe('the margin', () => {
  test('is 3% of the span once that passes 5 minutes, and 5 minutes below it', () => {
    expect(fitMarginMillisecondsOf(NOW_EPOCH_MILLISECONDS - 10 * HOUR_MILLISECONDS, NOW_EPOCH_MILLISECONDS)).toBe(18 * MINUTE_MILLISECONDS);
    expect(fitMarginMillisecondsOf(NOW_EPOCH_MILLISECONDS - HOUR_MILLISECONDS, NOW_EPOCH_MILLISECONDS)).toBe(5 * MINUTE_MILLISECONDS);
  });

  test('keeps an empty chart around now', () => {
    const span = fittedSpanOf([], NOW_EPOCH_MILLISECONDS);
    expect(span.fromEpochMilliseconds).toBe(NOW_EPOCH_MILLISECONDS - 5 * MINUTE_MILLISECONDS);
    expect(span.toEpochMilliseconds).toBe(NOW_EPOCH_MILLISECONDS + 5 * MINUTE_MILLISECONDS);
  });
});
