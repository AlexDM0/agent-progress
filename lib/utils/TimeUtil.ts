/** Every timestamp `agent-progress` writes or reads back is local-offset ISO 8601, never UTC, and that is the whole reason this module exists. */
import { DAY_MINUTES } from '../constants/Limits';

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR        = 60;
const MILLISECOND_DIGITS = 3;

const YEAR_DIGITS  = 4;
const FIELD_DIGITS = 2;

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
    case 'd': return DAY_MINUTES;
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
 * of `new Date('2026-09-18')`, and the direction a person typing `--at 09:00` means.
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

/** An ISO timestamp, the word `now`, or a signed offset (`-5m`, `+2h`); the sign is required, because a bare `5m` is ambiguous about direction. */
function resolveWhen(text: string, now: Date): Date | null {
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === 'now') return new Date(now.getTime());

  const relative = RELATIVE_WHEN_PATTERN.exec(trimmed);
  if (relative !== null) {
    const unitMinutes = minutesPerUnit(relative[3] ?? '');
    if (unitMinutes === null) return null;
    const signedMinutes = (relative[1] === '-' ? -1 : 1) * Number(relative[2] ?? '0') * unitMinutes;
    return new Date(now.getTime() + signedMinutes * MILLISECONDS_PER_MINUTE);
  }

  return parseIso(trimmed);
}

/** Reads `15m`, `1h`, `1d` or a bare number of minutes; zero is refused, because a tick step of zero lays out gridlines forever. */
function parseDurationMinutes(text: string): number | null {
  const match = DURATION_PATTERN.exec(text.trim());
  if (match === null) return null;
  const unitMinutes = minutesPerUnit(match[2] ?? 'm');
  if (unitMinutes === null) return null;
  const minutes = Number(match[1] ?? '0') * unitMinutes;
  return minutes > 0 ? minutes : null;
}

/** Epoch-millisecond arithmetic, never calendar fields, so it stays right across a daylight-saving boundary; the result is not rounded. */
function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MILLISECONDS_PER_MINUTE;
}

export const TimeUtil = {
  formatLocalIso,
  minutesBetween,
  parseDurationMinutes,
  parseIso,
  resolveWhen,
} as const;
