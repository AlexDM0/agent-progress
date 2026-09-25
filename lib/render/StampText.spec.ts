/**
 * The one stamp formatter. The cases that matter are the three forms a stored stamp takes against the viewer's day, a stamp whose offset
 * puts it on another day in the viewer's zone (it is compared as written, never parsed), and the instant forms, which are local time and so
 * are checked against the instant's own local date rather than a literal clock.
 */

import { describe, expect, test } from 'bun:test';

import type { StampTextSlices } from './page/StampText.ts';
import {
  calendarDateOf,
  fullInstantText,
  fullStampText,
  shortInstantText,
  shortStampText,
} from './page/StampText.ts';

const EXAMPLE_SLICES: StampTextSlices = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

const EXAMPLE_TODAY = '2026-09-18';

const MILLISECONDS_PER_DAY = 86_400_000;

const LOCAL_CLOCK = /^\d\d:\d\d$/;

describe('shortStampText', () => {
  test('shows only the clock of a stamp from today', () => {
    expect(shortStampText('2026-09-18T20:44:00+02:00', EXAMPLE_TODAY, EXAMPLE_SLICES)).toBe('20:44');
  });

  test('puts the month and day in front of a stamp from another day of the same year', () => {
    expect(shortStampText('2026-09-17T23:48:00+02:00', EXAMPLE_TODAY, EXAMPLE_SLICES)).toBe('09-17 23:48');
  });

  // In the viewer's zone this instant may fall on the 19th; the stamp keeps the wall clock of the machine that wrote it, so it is today's.
  test('reads the date as written, whatever offset the stamp carries', () => {
    expect(shortStampText('2026-09-18T23:30:00-05:00', EXAMPLE_TODAY, EXAMPLE_SLICES)).toBe('23:30');
  });

  test('shows a stamp from another year in full', () => {
    expect(shortStampText('2025-12-31T23:48:00+01:00', '2026-01-01', EXAMPLE_SLICES)).toBe('2025-12-31 23:48');
  });
});

describe('fullStampText', () => {
  test('is the date and the clock, the form every hover shows', () => {
    expect(fullStampText('2026-09-18T20:44:00+02:00', EXAMPLE_SLICES)).toBe('2026-09-18 20:44');
  });
});

describe('the instant forms', () => {
  const instant = Date.UTC(2026, 8, 18, 12, 0, 0);
  const today   = calendarDateOf(instant);

  test('names the viewer\'s local day of an instant', () => {
    const moment = new Date(instant);

    expect(today).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(Number(today.slice(8))).toBe(moment.getDate());
    expect(Number(today.slice(0, 4))).toBe(moment.getFullYear());
  });

  test('shows only the local clock of an instant from today, and the date and clock in full', () => {
    const shown = shortInstantText(instant, today);

    expect(shown).toMatch(LOCAL_CLOCK);
    expect(fullInstantText(instant)).toBe(`${today} ${shown}`);
  });

  test('dates an instant from another day of the same year by month and day', () => {
    const yesterday = instant - MILLISECONDS_PER_DAY;

    expect(shortInstantText(yesterday, today)).toBe(fullInstantText(yesterday).slice(5));
  });

  test('shows an instant from another year in full', () => {
    const lastYear = instant - 365 * MILLISECONDS_PER_DAY;

    expect(shortInstantText(lastYear, today)).toBe(fullInstantText(lastYear));
    expect(fullInstantText(lastYear)).toMatch(/^2025-\d\d-\d\d \d\d:\d\d$/);
  });
});
