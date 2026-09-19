/**
 * `TimeUtil` against its own contract: `parseIso` returns `null` and never an `Invalid Date`, and
 * every assertion is written to hold in any timezone, because the suite must not reach for `TZ`.
 */
import { expect, test } from 'bun:test';

import { TimeUtil } from './TimeUtil';

const {
  formatLocalIso,
  minutesBetween,
  parseDurationMinutes,
  parseIso,
  resolveWhen,
} = TimeUtil;

const LOCAL_ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const MILLISECONDS_PER_MINUTE = 60_000;

const FIXED_INSTANT = new Date(Date.UTC(2026, 8, 18, 18, 11, 3));

test('writes seconds precision with a signed local offset and no milliseconds', () => {
  expect(formatLocalIso(FIXED_INSTANT)).toMatch(LOCAL_ISO_SHAPE);
  expect(formatLocalIso(FIXED_INSTANT)).not.toContain('.');
  expect(formatLocalIso(FIXED_INSTANT)).not.toContain('Z');
});

test('the offset it writes is this machine\'s own, not UTC', () => {
  const written = formatLocalIso(FIXED_INSTANT);
  const offsetMinutes = -FIXED_INSTANT.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const expectedOffset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  expect(written.slice(-6)).toBe(expectedOffset);
});

test('a fixed date survives a round trip through the written form, to the second', () => {
  const secondsPrecisionInstant = new Date(Math.floor(FIXED_INSTANT.getTime() / 1000) * 1000);
  const roundTripped = parseIso(formatLocalIso(secondsPrecisionInstant));
  expect(roundTripped).not.toBeNull();
  expect(roundTripped?.getTime()).toBe(secondsPrecisionInstant.getTime());
});

test('a round trip drops sub-second precision and nothing else', () => {
  const withMilliseconds = new Date(FIXED_INSTANT.getTime() + 456);
  const roundTripped = parseIso(formatLocalIso(withMilliseconds));
  expect(roundTripped?.getTime()).toBe(withMilliseconds.getTime() - 456);
});

test('reads a half-hour positive offset as the instant it names', () => {
  expect(parseIso('2026-09-18T20:11:03+05:30')?.toISOString()).toBe('2026-09-18T14:41:03.000Z');
});

test('reads a negative offset as the instant it names', () => {
  expect(parseIso('2026-09-18T20:11:03-03:00')?.toISOString()).toBe('2026-09-18T23:11:03.000Z');
});

test('reads an offset written without its colon, which ISO 8601 allows and people type', () => {
  expect(parseIso('2026-09-18T20:11:03+0530')?.getTime()).toBe(parseIso('2026-09-18T20:11:03+05:30')?.getTime());
});

test('reads the tolerated RFC 3339 spellings: a lower-case t and z, and a space for the T', () => {
  const canonical = parseIso('2026-09-18T20:11:03Z')?.getTime();
  expect(parseIso('2026-09-18t20:11:03z')?.getTime()).toBe(canonical);
  expect(parseIso('2026-09-18 20:11:03Z')?.getTime()).toBe(canonical);
});

test('reads fractional seconds and a missing seconds field', () => {
  expect(parseIso('2026-09-18T20:11:03.250Z')?.toISOString()).toBe('2026-09-18T20:11:03.250Z');
  expect(parseIso('2026-09-18T20:11Z')?.toISOString()).toBe('2026-09-18T20:11:00.000Z');
});

test('a timestamp with no offset is read as local time, and a bare date as local midnight', () => {
  expect(parseIso('2026-09-18T09:00:00')?.getTime()).toBe(new Date(2026, 8, 18, 9, 0, 0).getTime());
  expect(parseIso('2026-09-18')?.getTime()).toBe(new Date(2026, 8, 18, 0, 0, 0).getTime());
});

test('garbage is null, and never an Invalid Date', () => {
  const garbage = [
    '',
    '   ',
    'yesterday',
    'now',
    '2026-13-01',
    '2026-02-30',
    '2026-09-18T25:00:00Z',
    '2026-09-18T20:11:03+99:00',
    '18-09-2026',
    '2026-09-18T20:11:03+02:00 extra',
  ];
  for (const text of garbage) {
    const parsed = parseIso(text);
    expect(parsed, `"${text}" is refused`).toBeNull();
  }
  expect(garbage.map((text) => parseIso(text)).filter((parsed) => parsed !== null && Number.isNaN(parsed.getTime()))).toEqual([]);
});

test('a four-digit year below 1900 is read as itself rather than relocated into the twentieth century', () => {
  expect(parseIso('0099-01-01T00:00:00Z')?.getUTCFullYear()).toBe(99);
});

test('resolveWhen understands the word now, and hands back a date the caller can keep', () => {
  const now = new Date(Date.UTC(2026, 8, 18, 18, 0, 0));
  const resolved = resolveWhen('now', now);
  expect(resolved?.getTime()).toBe(now.getTime());
  expect(resolved).not.toBe(now);
});

test('resolveWhen reads the signed offsets every state-changing command accepts', () => {
  const now = new Date(Date.UTC(2026, 8, 18, 18, 0, 0));
  expect(minutesBetween(resolveWhen('-5m', now) ?? now, now)).toBe(5);
  expect(minutesBetween(resolveWhen('-2h', now) ?? now, now)).toBe(120);
  expect(minutesBetween(resolveWhen('-1d', now) ?? now, now)).toBe(1440);
  expect(minutesBetween(now, resolveWhen('+30m', now) ?? now)).toBe(30);
});

test('resolveWhen falls through to an ISO timestamp, and refuses an unsigned duration', () => {
  const now = new Date(Date.UTC(2026, 8, 18, 18, 0, 0));
  expect(resolveWhen('2026-09-18T20:11:03+02:00', now)?.toISOString()).toBe('2026-09-18T18:11:03.000Z');
  expect(resolveWhen('5m', now)).toBeNull();
  expect(resolveWhen('tomorrow', now)).toBeNull();
  expect(resolveWhen('', now)).toBeNull();
});

test('parseDurationMinutes reads a unit or a bare number of minutes', () => {
  expect(parseDurationMinutes('15m')).toBe(15);
  expect(parseDurationMinutes('1h')).toBe(60);
  expect(parseDurationMinutes('1d')).toBe(1440);
  expect(parseDurationMinutes('45')).toBe(45);
  expect(parseDurationMinutes('90M')).toBe(90);
});

test('parseDurationMinutes refuses zero, because a tick step of zero minutes lays out gridlines forever', () => {
  expect(parseDurationMinutes('0')).toBeNull();
  expect(parseDurationMinutes('0m')).toBeNull();
  expect(parseDurationMinutes('-15m')).toBeNull();
  expect(parseDurationMinutes('quarter of an hour')).toBeNull();
});

test('minutesBetween is signed and counts backwards as readily as forwards', () => {
  const earlier = new Date(Date.UTC(2026, 8, 18, 18, 0, 0));
  const later = new Date(Date.UTC(2026, 8, 18, 19, 30, 0));
  expect(minutesBetween(earlier, later)).toBe(90);
  expect(minutesBetween(later, earlier)).toBe(-90);
});

test('minutesBetween across the European spring-forward counts the hour that does not exist as not existing', () => {
  // Europe/Amsterdam moves to +02:00 at 02:00 local on 2026-03-29, so these two are sixty minutes apart.
  const beforeTheJump = parseIso('2026-03-29T01:30:00+01:00');
  const afterTheJump = parseIso('2026-03-29T03:30:00+02:00');
  expect(beforeTheJump).not.toBeNull();
  expect(afterTheJump).not.toBeNull();
  expect(minutesBetween(beforeTheJump ?? new Date(0), afterTheJump ?? new Date(0))).toBe(60);
});

test('a whole day across the spring-forward is twenty-three hours, not twenty-four', () => {
  const dayBefore = parseIso('2026-03-28T12:00:00+01:00') ?? new Date(0);
  const dayAfter = parseIso('2026-03-29T12:00:00+02:00') ?? new Date(0);
  expect(minutesBetween(dayBefore, dayAfter)).toBe(23 * 60);
});

test('minutesBetween keeps sub-minute differences instead of rounding them away', () => {
  const start = new Date(Date.UTC(2026, 8, 18, 18, 0, 0));
  const thirtySecondsLater = new Date(start.getTime() + MILLISECONDS_PER_MINUTE / 2);
  expect(minutesBetween(start, thirtySecondsLater)).toBe(0.5);
});
