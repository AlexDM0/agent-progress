/** The Fit preset's range: from the earliest start among the rows shown to now, with one margin on both ends. DOM-free, no clock. */

import { MILLISECONDS_PER_MINUTE }                      from '../../../src/lib/local-time/LocalTimeUtil.ts';
import type { Task }                                    from '../../../src/lib/tracker-model/@types/Task.ts';
import { TimeUtil }                                     from '../../utils/TimeUtil.ts';
import { FIT_MARGIN_MINIMUM_MINUTES, FIT_MARGIN_SHARE } from '../constants/ProgressChart.ts';

export interface FittedSpan {
  earliestStartEpochMilliseconds: number;
  marginMilliseconds:             number;
  fromEpochMilliseconds:          number;
  toEpochMilliseconds:            number;
}

/** The earliest start among the rows, or now when none has started, so an empty chart still spans its minimum margin. */
function earliestStartEpochMillisecondsOf(tasks: readonly Task[], nowEpochMilliseconds: number): number {
  let earliest = nowEpochMilliseconds;
  for (const task of tasks) {
    const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(task.start);
    if (startEpochMilliseconds !== null && startEpochMilliseconds < earliest) {
      earliest = startEpochMilliseconds;
    }
  }
  return earliest;
}

function fitMarginMillisecondsOf(earliestStartEpochMilliseconds: number, nowEpochMilliseconds: number): number {
  return Math.max(FIT_MARGIN_MINIMUM_MINUTES * MILLISECONDS_PER_MINUTE, (nowEpochMilliseconds - earliestStartEpochMilliseconds) * FIT_MARGIN_SHARE);
}

function fittedSpanOf(tasks: readonly Task[], nowEpochMilliseconds: number): FittedSpan {
  const earliestStartEpochMilliseconds = earliestStartEpochMillisecondsOf(tasks, nowEpochMilliseconds);
  const marginMilliseconds             = fitMarginMillisecondsOf(earliestStartEpochMilliseconds, nowEpochMilliseconds);
  return {
    earliestStartEpochMilliseconds,
    marginMilliseconds,
    fromEpochMilliseconds: earliestStartEpochMilliseconds - marginMilliseconds,
    toEpochMilliseconds:   nowEpochMilliseconds + marginMilliseconds,
  };
}

export const FitRangeUtil = {
  earliestStartEpochMillisecondsOf,
  fitMarginMillisecondsOf,
  fittedSpanOf,
} as const;
