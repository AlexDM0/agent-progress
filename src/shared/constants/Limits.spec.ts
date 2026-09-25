/**
 * The relations the code silently depends on, not the values themselves, so the constants stay
 * tunable: the tick ladder ascends, and a waiter gives up long before a lock could become stale.
 */
import { expect, test } from 'bun:test';

import { LIMITS } from './Limits';

const MILLISECONDS_PER_SECOND = 1000;
const DAYS_PER_WEEK = 7;

test('the tick ladder is strictly ascending, so the first rung that fits is also the smallest one that fits', () => {
  const ascendingPairs = LIMITS.TICK_STEP_LADDER_MINUTES.slice(1).map((step, index) => step > (LIMITS.TICK_STEP_LADDER_MINUTES[index] ?? 0));
  expect(ascendingPairs.length, 'the ladder has rungs to compare').toBeGreaterThan(5);
  expect(ascendingPairs.every(Boolean)).toBe(true);
});

test('the ladder ends at exactly one day, so the multiples-of-a-day fallback continues it without a gap', () => {
  expect(LIMITS.TICK_STEP_LADDER_MINUTES.at(-1)).toBe(LIMITS.DAY_MINUTES);
});

test('every rung is a whole number of minutes and at least one minute, because a tick label has minute precision', () => {
  expect(LIMITS.TICK_STEP_LADDER_MINUTES.every((step) => Number.isInteger(step) && step >= 1)).toBe(true);
});

test('a waiter gives up long before a lock could become stale, so a takeover only ever happens to a lock that was already old on arrival', () => {
  expect(LIMITS.LOCK_RETRY_COUNT * LIMITS.LOCK_RETRY_INTERVAL_MILLISECONDS).toBeLessThan(LIMITS.LOCK_STALE_MILLISECONDS);
});

test('the patience budget is still long enough for several normal commands to pass through the lock', () => {
  expect(LIMITS.LOCK_RETRY_COUNT * LIMITS.LOCK_RETRY_INTERVAL_MILLISECONDS).toBeGreaterThanOrEqual(3 * MILLISECONDS_PER_SECOND);
});

test('the axis label limits line up with the day and the week they are named for', () => {
  expect(LIMITS.HOURS_AXIS_LABEL_LIMIT_MINUTES).toBe(LIMITS.DAY_MINUTES);
  expect<number>(LIMITS.WEEK_AXIS_LABEL_LIMIT_MINUTES).toBe(DAYS_PER_WEEK * LIMITS.DAY_MINUTES);
});

test('the axis padding is a fraction of the minimum span, so padding alone can never be the whole chart', () => {
  expect(LIMITS.AXIS_PADDING_MINUTES).toBeGreaterThan(0);
  expect(LIMITS.AXIS_PADDING_MINUTES).toBeLessThan(LIMITS.AXIS_MINIMUM_SPAN_MINUTES);
});

test('the minimum bar width is a visible sliver rather than a whole column', () => {
  expect(LIMITS.MINIMUM_BAR_WIDTH_PERCENT).toBeGreaterThan(0);
  expect(LIMITS.MINIMUM_BAR_WIDTH_PERCENT).toBeLessThan(5);
});

test('the axis draws enough ticks to read and few enough to fit', () => {
  expect(LIMITS.MAXIMUM_TICKS_PER_AXIS).toBeGreaterThanOrEqual(4);
  expect(LIMITS.MAXIMUM_TICKS_PER_AXIS).toBeLessThanOrEqual(24);
});

test('a ticket id is padded to at least two digits, so a listing of the first ten tickets still sorts in filing order', () => {
  expect(LIMITS.TICKET_ID_DIGITS).toBeGreaterThanOrEqual(2);
});
