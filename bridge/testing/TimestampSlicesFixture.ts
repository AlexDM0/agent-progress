/** The stamp slices and duration units of the page payload's `limits`, built from the shared constants as the render service builds them. Test-only. */
import { TIME_UNITS }                          from '../../src/shared/constants/TimeUnits.ts';
import { TIMESTAMP_SLICES }                    from '../../src/shared/constants/TimestampSlices.ts';
import type { DurationUnits, TimestampSlices } from '../utils/TimeUtil.ts';

export const EXAMPLE_TIMESTAMP_SLICES: Readonly<TimestampSlices> = Object.freeze({
  dateAndClockLength:    TIMESTAMP_SLICES.DATE_AND_CLOCK_LENGTH_CHARACTERS,
  calendarDateLength:    TIMESTAMP_SLICES.CALENDAR_DATE_LENGTH_CHARACTERS,
  monthAndDaySliceStart: TIMESTAMP_SLICES.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET,
  clockSliceStart:       TIMESTAMP_SLICES.CLOCK_SLICE_START_CHARACTER_OFFSET,
  clockSliceEnd:         TIMESTAMP_SLICES.CLOCK_SLICE_END_CHARACTER_OFFSET,
});

export const EXAMPLE_PAGE_LIMITS: Readonly<TimestampSlices & DurationUnits> = Object.freeze({
  ...EXAMPLE_TIMESTAMP_SLICES,
  hourMinutes: TIME_UNITS.HOUR_MINUTES,
  dayMinutes:  TIME_UNITS.DAY_MINUTES,
});
