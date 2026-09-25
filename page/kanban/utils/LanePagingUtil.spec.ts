/** The closed lanes open 15, then 25 at a time, clamped to the first page … the lane's count whatever storage says. */

import { describe, expect, test } from 'bun:test';
import { shownCountFrom }         from '../../preferences/ViewerPreferences.ts';
import { LanePagingUtil }         from './LanePagingUtil.ts';

const { cappedLaneShownCount, nextPageSizeFor, shownCountAfterMore } = LanePagingUtil;

describe('the capped lanes', () => {
  const LANE_COUNT = 52;

  test('open 15, then 40 after one step, then all 52 after the remaining 12', () => {
    const first = cappedLaneShownCount(shownCountFrom(null), LANE_COUNT);
    const second = shownCountAfterMore(first, LANE_COUNT);

    expect(first).toBe(15);
    expect(nextPageSizeFor(first, LANE_COUNT)).toBe(25);
    expect(second).toBe(40);
    expect(nextPageSizeFor(second, LANE_COUNT)).toBe(12);
    expect(shownCountAfterMore(second, LANE_COUNT)).toBe(52);
    expect(nextPageSizeFor(52, LANE_COUNT)).toBe(0);
  });

  test.each([
    ['a count above the lane', '80', 52],
    ['a count below the first page', '3', 15],
    ['text that is no number', 'many', 15],
    ['a fraction', '20.5', 15],
  ])('clamps %s to the first page … the lane’s count', (_description, stored, expected) => {
    expect(cappedLaneShownCount(shownCountFrom(stored), LANE_COUNT)).toBe(expected);
  });
});
