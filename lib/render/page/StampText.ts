/**
 * The one formatter every stamp on the page goes through: a stamp from the viewer's day shows only its clock, one from another day of the
 * same year gains its month and day, and one from another year is shown in full. Nothing here reads the clock; "today" is handed in.
 */

const TWO_DIGITS = 10;

const FIRST_MONTH_NUMBER = 1;

/** The slice bounds of a stored stamp this module reads, declared here because `lib/render/page/PageMarkup.ts` imports this module. */
export interface StampTextSlices {
  dateAndClockLength:    number;
  calendarDateLength:    number;
  monthAndDaySliceStart: number;
  clockSliceStart:       number;
  clockSliceEnd:         number;
}

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

export function calendarDateOf(epochMilliseconds: number): string {
  const moment = new Date(epochMilliseconds);
  return `${moment.getFullYear()}-${monthAndDayOf(moment)}`;
}

export function fullStampText(stamp: string, slices: StampTextSlices): string {
  return stamp.slice(0, slices.dateAndClockLength).replace('T', ' ');
}

/** Sliced, never parsed: the stamp keeps the wall clock and the offset of the machine that recorded it, so its date is compared as written. */
export function shortStampText(stamp: string, todayCalendarDate: string, slices: StampTextSlices): string {
  if (stamp.slice(0, slices.calendarDateLength) === todayCalendarDate) {
    return stamp.slice(slices.clockSliceStart, slices.clockSliceEnd);
  }
  if (stamp.slice(0, slices.monthAndDaySliceStart) === todayCalendarDate.slice(0, slices.monthAndDaySliceStart)) {
    return stamp.slice(slices.monthAndDaySliceStart, slices.clockSliceEnd).replace('T', ' ');
  }
  return fullStampText(stamp, slices);
}

export function fullInstantText(epochMilliseconds: number): string {
  return `${calendarDateOf(epochMilliseconds)} ${clockOf(new Date(epochMilliseconds))}`;
}

export function shortInstantText(epochMilliseconds: number, todayCalendarDate: string): string {
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
