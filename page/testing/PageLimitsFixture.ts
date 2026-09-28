/** The limits and stamp slices the render service puts in the progress island, built from the shared constants as it builds them. Test-only. */
import type { PageLimits }      from '../../src/shared/@types/PagePayload.ts';
import { LIMITS }               from '../../src/shared/constants/Limits.ts';
import { TIME_UNITS }           from '../../src/shared/constants/TimeUnits.ts';
import { TIMESTAMP_SLICES }     from '../../src/shared/constants/TimestampSlices.ts';
import type { TimestampSlices } from '../utils/TimeUtil.ts';

export const EXAMPLE_TIMESTAMP_SLICES: Readonly<TimestampSlices> = Object.freeze({
  dateAndClockLength:    TIMESTAMP_SLICES.DATE_AND_CLOCK_LENGTH_CHARACTERS,
  calendarDateLength:    TIMESTAMP_SLICES.CALENDAR_DATE_LENGTH_CHARACTERS,
  monthAndDaySliceStart: TIMESTAMP_SLICES.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET,
  clockSliceStart:       TIMESTAMP_SLICES.CLOCK_SLICE_START_CHARACTER_OFFSET,
  clockSliceEnd:         TIMESTAMP_SLICES.CLOCK_SLICE_END_CHARACTER_OFFSET,
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
  hourMinutes:                 TIME_UNITS.HOUR_MINUTES,
  dayMinutes:                  TIME_UNITS.DAY_MINUTES,
  tickCountSafetyBound:        LIMITS.TICK_COUNT_SAFETY_BOUND,
  doneWorkVisibleMilliseconds: LIMITS.DONE_WORK_VISIBLE_MILLISECONDS,
});
