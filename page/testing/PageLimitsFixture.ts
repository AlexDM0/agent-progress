/** The limits and stamp slices the render service puts in the progress island, built from `LIMITS` as it builds them. Test-only. */
import type { PageLimits }      from '../../src/shared/@types/PagePayload.ts';
import { LIMITS }               from '../../src/shared/constants/Limits.ts';
import type { TimestampSlices } from '../utils/TimeUtil.ts';

export const EXAMPLE_TIMESTAMP_SLICES: Readonly<TimestampSlices> = Object.freeze({
  dateAndClockLength:    LIMITS.DATE_AND_CLOCK_LENGTH_CHARACTERS,
  calendarDateLength:    LIMITS.CALENDAR_DATE_LENGTH_CHARACTERS,
  monthAndDaySliceStart: LIMITS.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET,
  clockSliceStart:       LIMITS.CLOCK_SLICE_START_CHARACTER_OFFSET,
  clockSliceEnd:         LIMITS.CLOCK_SLICE_END_CHARACTER_OFFSET,
});

export const EXAMPLE_PAGE_LIMITS: Readonly<PageLimits> = Object.freeze({
  ...EXAMPLE_TIMESTAMP_SLICES,
  tickStepLadderMinutes:       LIMITS.TICK_STEP_LADDER_MINUTES,
  maximumTicksPerAxis:         LIMITS.MAXIMUM_TICKS_PER_AXIS,
  axisMinimumSpanMinutes:      LIMITS.AXIS_MINIMUM_SPAN_MINUTES,
  axisPaddingMinutes:          LIMITS.AXIS_PADDING_MINUTES,
  minimumBarWidthPercent:      LIMITS.MINIMUM_BAR_WIDTH_PERCENT,
  hoursAxisLabelLimitMinutes:  LIMITS.HOURS_AXIS_LABEL_LIMIT_MINUTES,
  weekAxisLabelLimitMinutes:   LIMITS.WEEK_AXIS_LABEL_LIMIT_MINUTES,
  hourMinutes:                 LIMITS.HOUR_MINUTES,
  dayMinutes:                  LIMITS.DAY_MINUTES,
  tickCountSafetyBound:        LIMITS.TICK_COUNT_SAFETY_BOUND,
  doneWorkVisibleMilliseconds: LIMITS.DONE_WORK_VISIBLE_MILLISECONDS,
});
