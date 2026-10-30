/** The geometry limits and stamp slices the render service puts in the page payload, built from the shared constants as it builds them. Test-only. */
import { LIMITS }                                          from '../../src/shared/constants/Limits.ts';
import type { TimelineLimits }                             from '../@types/Timeline.ts';
import type { TimestampSlices }                            from '../utils/TimeUtil.ts';
import { EXAMPLE_PAGE_LIMITS as EXAMPLE_SLICES_AND_UNITS } from './TimestampSlicesFixture.ts';

export const EXAMPLE_PAGE_LIMITS: Readonly<TimelineLimits & TimestampSlices> = Object.freeze({
  ...EXAMPLE_SLICES_AND_UNITS,
  tickStepLadderMinutes:      LIMITS.TICK_STEP_LADDER_MINUTES,
  maximumTicksPerAxis:        LIMITS.MAXIMUM_TICKS_PER_AXIS,
  axisMinimumSpanMinutes:     LIMITS.AXIS_MINIMUM_SPAN_MINUTES,
  axisPaddingMinutes:         LIMITS.AXIS_PADDING_MINUTES,
  minimumBarWidthPercent:     LIMITS.MINIMUM_BAR_WIDTH_PERCENT,
  hoursAxisLabelLimitMinutes: LIMITS.HOURS_AXIS_LABEL_LIMIT_MINUTES,
  weekAxisLabelLimitMinutes:  LIMITS.WEEK_AXIS_LABEL_LIMIT_MINUTES,
  tickCountSafetyBound:       LIMITS.TICK_COUNT_SAFETY_BOUND,
});
