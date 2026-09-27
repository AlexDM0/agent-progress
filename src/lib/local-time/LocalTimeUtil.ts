/**
 * Timestamps as local-offset ISO 8601, never UTC: formatted, parsed, and resolved from `now` or a signed offset. It depends on no other
 * lib package.
 */

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR        = 60;
const MINUTES_PER_DAY         = 1440;
const MILLISECOND_DIGITS = 3;

const YEAR_DIGITS  = 4;
const FIELD_DIGITS = 2;

const FIRST_FOUR_DIGIT_YEAR = 0;
const LAST_FOUR_DIGIT_YEAR  = 9999;

const LAST_MONTH_INDEX = 11;
const FIRST_DAY        = 1;
const LAST_DAY         = 31;
const LAST_HOUR        = 23;
const LAST_MINUTE      = 59;
const LAST_SECOND      = 59;

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(?:([Zz])|([+-])(\d{2}):?(\d{2}))?)?$/;

const RELATIVE_WHEN_PATTERN = /^([+-])(\d+)([mhd])$/i;

const DURATION_PATTERN = /^(\d+)\s*([mhd])?$/i;

function minutesPerUnit(unit: string): number | null {
  switch (unit.toLowerCase()) {
    case 'm': return 1;
    case 'h': return MINUTES_PER_HOUR;
    case 'd': return MINUTES_PER_DAY;
    default:  return null;
  }
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Local-offset ISO 8601 at seconds precision (`2026-09-18T20:11:03+02:00`); milliseconds are dropped, so a round trip through `parseIso` loses them. */
function formatLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes < 0 ? '-' : '+';
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHoursPart = Math.floor(absoluteOffsetMinutes / MINUTES_PER_HOUR);
  const offsetMinutesPart = absoluteOffsetMinutes % MINUTES_PER_HOUR;
  const calendarPart = `${padNumber(date.getFullYear(), YEAR_DIGITS)}-${padNumber(date.getMonth() + 1, FIELD_DIGITS)}-${padNumber(date.getDate(), FIELD_DIGITS)}`;
  const clockPart    = `${padNumber(date.getHours(), FIELD_DIGITS)}:${padNumber(date.getMinutes(), FIELD_DIGITS)}:${padNumber(date.getSeconds(), FIELD_DIGITS)}`;
  return `${calendarPart}T${clockPart}${offsetSign}${padNumber(offsetHoursPart, FIELD_DIGITS)}:${padNumber(offsetMinutesPart, FIELD_DIGITS)}`;
}

function localComponentsSurvived(date: Date, year: number, monthIndex: number, day: number): boolean {
  return date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day;
}

/**
 * Anything not fully understood is `null`, never an `Invalid Date`, and every caller depends on that.
 * A timestamp with no offset is read as local time and a bare date as local midnight — the opposite
 * of `new Date('2026-09-18')`, and the direction a person typing `09:00` means.
 */
function parseIso(text: string): Date | null {
  const match = ISO_TIMESTAMP_PATTERN.exec(text.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '0');
  const minute = Number(match[5] ?? '0');
  const second = Number(match[6] ?? '0');
  const millisecond = Number(`${match[7] ?? ''}000`.slice(0, MILLISECOND_DIGITS));
  if (monthIndex < 0 || monthIndex > LAST_MONTH_INDEX || day < FIRST_DAY || day > LAST_DAY) return null;
  if (hour > LAST_HOUR || minute > LAST_MINUTE || second > LAST_SECOND) return null;

  const utcMarker = match[8];
  const offsetSign = match[9];
  if (utcMarker === undefined && offsetSign === undefined) {
    const localDate = new Date(year, monthIndex, day, hour, minute, second, millisecond);
    // The constructor maps a two-digit year onto 1900+, so the full year is set again to keep 0099 from arriving as 1999.
    localDate.setFullYear(year, monthIndex, day);
    return localComponentsSurvived(localDate, year, monthIndex, day) ? localDate : null;
  }

  const offsetHours = Number(match[10] ?? '0');
  const offsetMinutes = Number(match[11] ?? '0');
  if (offsetHours > LAST_HOUR || offsetMinutes > LAST_MINUTE) return null;
  const signedOffsetMinutes = (offsetSign === '-' ? -1 : 1) * (offsetHours * MINUTES_PER_HOUR + offsetMinutes);
  const instant = new Date(Date.UTC(year, monthIndex, day, hour, minute, second, millisecond));
  instant.setUTCFullYear(year, monthIndex, day);
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== monthIndex || instant.getUTCDate() !== day) return null;
  return new Date(instant.getTime() - signedOffsetMinutes * MILLISECONDS_PER_MINUTE);
}

/** An `Invalid Date` fails too: its year is `NaN`. */
function yearIsWritableAsFourDigits(date: Date): boolean {
  const year = date.getFullYear();
  return year >= FIRST_FOUR_DIGIT_YEAR && year <= LAST_FOUR_DIGIT_YEAR;
}

/**
 * An ISO timestamp, the word `now`, or a signed offset (`-5m`, `+2h`); the sign is required, because a bare `5m` is ambiguous about direction.
 * An offset landing outside the four-digit years `formatLocalIso` writes and `parseIso` reads back is `null`, like any other unreadable text.
 */
function resolveWhen(text: string, now: Date): Date | null {
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === 'now') return new Date(now.getTime());

  const relative = RELATIVE_WHEN_PATTERN.exec(trimmed);
  if (relative !== null) {
    const unitMinutes = minutesPerUnit(relative[3] ?? '');
    if (unitMinutes === null) return null;
    const signedMinutes = (relative[1] === '-' ? -1 : 1) * Number(relative[2] ?? '0') * unitMinutes;
    const resolved = new Date(now.getTime() + signedMinutes * MILLISECONDS_PER_MINUTE);
    return yearIsWritableAsFourDigits(resolved) ? resolved : null;
  }

  return parseIso(trimmed);
}

/** Reads `15m`, `1h`, `1d` or a bare number of minutes; zero is refused, so a returned duration is always a positive step. */
function parseDurationMinutes(text: string): number | null {
  const match = DURATION_PATTERN.exec(text.trim());
  if (match === null) return null;
  const unitMinutes = minutesPerUnit(match[2] ?? 'm');
  if (unitMinutes === null) return null;
  const minutes = Number(match[1] ?? '0') * unitMinutes;
  return minutes > 0 ? minutes : null;
}

export const LocalTimeUtil = {
  formatLocalIso,
  parseDurationMinutes,
  parseIso,
  resolveWhen,
} as const;
