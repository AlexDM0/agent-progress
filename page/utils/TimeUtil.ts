/**
 * The one formatter every stamp on the page goes through: a stamp from the viewer's day shows only its clock, one from another day of the
 * same year gains its month and day, and one from another year is shown in full. Nothing here reads the clock; "today" is handed in, and
 * comparing a stamp or instant with the viewer's day is a stated clock exception that decides only the text printed. It also formats
 * durations and parses stamps.
 */

import type { PageLimits }         from '../../src/shared/@types/PagePayload.ts';
import { MILLISECONDS_PER_MINUTE } from '../constants/Units.ts';

const TWO_DIGITS = 10;

const FIRST_MONTH_NUMBER = 1;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY    = 24;

const SHORTEST_NAMED_DURATION = 'under a minute';

export type TimestampSlices = Pick<PageLimits, 'dateAndClockLength' | 'calendarDateLength' | 'monthAndDaySliceStart' | 'clockSliceStart' | 'clockSliceEnd'>;

function padToTwoDigits(value: number): string {
  return value < TWO_DIGITS ? `0${value}` : String(value);
}

function clockOf(moment: Date): string {
  return `${padToTwoDigits(moment.getHours())}:${padToTwoDigits(moment.getMinutes())}`;
}

function monthAndDayOf(moment: Date): string {
  return `${padToTwoDigits(moment.getMonth() + FIRST_MONTH_NUMBER)}-${padToTwoDigits(moment.getDate())}`;
}

function yearOf(calendarDate: string): string {
  return calendarDate.split('-', 1)[0] ?? '';
}

function calendarDateOf(epochMilliseconds: number): string {
  const moment = new Date(epochMilliseconds);
  return `${moment.getFullYear()}-${monthAndDayOf(moment)}`;
}

function fullStampText(stamp: string, slices: TimestampSlices): string {
  return stamp.slice(0, slices.dateAndClockLength).replace('T', ' ');
}

/** Sliced, never parsed: the stamp keeps the wall clock and the offset of the machine that recorded it, so its date is compared as written. */
function shortStampText(stamp: string, todayCalendarDate: string, slices: TimestampSlices): string {
  if (stamp.slice(0, slices.calendarDateLength) === todayCalendarDate) {
    return stamp.slice(slices.clockSliceStart, slices.clockSliceEnd);
  }
  if (stamp.slice(0, slices.monthAndDaySliceStart) === todayCalendarDate.slice(0, slices.monthAndDaySliceStart)) {
    return stamp.slice(slices.monthAndDaySliceStart, slices.clockSliceEnd).replace('T', ' ');
  }
  return fullStampText(stamp, slices);
}

function fullInstantText(epochMilliseconds: number): string {
  return `${calendarDateOf(epochMilliseconds)} ${clockOf(new Date(epochMilliseconds))}`;
}

function shortInstantText(epochMilliseconds: number, todayCalendarDate: string): string {
  const moment       = new Date(epochMilliseconds);
  const calendarDate = calendarDateOf(epochMilliseconds);
  if (calendarDate === todayCalendarDate) {
    return clockOf(moment);
  }
  if (yearOf(calendarDate) === yearOf(todayCalendarDate)) {
    return `${monthAndDayOf(moment)} ${clockOf(moment)}`;
  }
  return fullInstantText(epochMilliseconds);
}

/** Null for a span that runs backwards, which a backfilled `--at` can write: it is no duration, not a short one. */
function formatDuration(milliseconds: number): string | null {
  if (milliseconds < 0) {
    return null;
  }
  const totalMinutes = Math.floor(milliseconds / MILLISECONDS_PER_MINUTE);
  if (totalMinutes < 1) {
    return SHORTEST_NAMED_DURATION;
  }
  const days    = Math.floor(totalMinutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours   = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (days > 0) {
    return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Instants the tool wrote are sliced for display; a span between two of them has no wall clock to preserve, so it is parsed and formatted. */
function epochMillisecondsOf(stamp: string | null | undefined): number | null {
  if (stamp === null || stamp === undefined || stamp === '') {
    return null;
  }
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? null : parsed;
}

export const TimeUtil = {
  calendarDateOf,
  clockOf,
  monthAndDayOf,
  fullStampText,
  shortStampText,
  fullInstantText,
  shortInstantText,
  formatDuration,
  epochMillisecondsOf,
} as const;
