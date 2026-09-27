/**
 * The two measures the ticket Timeline's data and markup share. A position matters at the axis ends, at its midpoint and outside it, where
 * it runs past 0 or 100 unclamped because the markup clamps. A duration's text is the page's duration wording, or empty where that names
 * none, so a backwards span leaves a blank cell rather than a word.
 */

import { describe, expect, test }  from 'bun:test';
import { EXAMPLE_PAGE_LIMITS }     from '../../testing/PageLimitsFixture.ts';
import { TimeUtil }                from '../../utils/TimeUtil.ts';
import type { TicketTimelineAxis } from '../@types/TicketTimeline.ts';
import { TicketTimelineUtil }      from './TicketTimelineUtil.ts';

const { percentAlong, durationTextOf } = TicketTimelineUtil;

const EXAMPLE_AXIS: TicketTimelineAxis = {
  fromEpochMilliseconds:       1_000_000,
  toEpochMilliseconds:         3_000_000,
  filedEpochMilliseconds:      1_050_000,
  lastMomentEpochMilliseconds: 2_950_000,
};

describe('percentAlong', () => {
  test('the axis start sits at 0 and its end at 100', () => {
    expect(percentAlong(EXAMPLE_AXIS, EXAMPLE_AXIS.fromEpochMilliseconds)).toBe(0);
    expect(percentAlong(EXAMPLE_AXIS, EXAMPLE_AXIS.toEpochMilliseconds)).toBe(100);
  });

  test('the midpoint of the axis sits at 50', () => {
    expect(percentAlong(EXAMPLE_AXIS, 2_000_000)).toBe(50);
  });

  test('a moment outside the axis runs linearly below 0 or above 100, unclamped', () => {
    expect(percentAlong(EXAMPLE_AXIS, 1_500_000)).toBe(25);
    expect(percentAlong(EXAMPLE_AXIS, 500_000)).toBe(-25);
    expect(percentAlong(EXAMPLE_AXIS, 3_500_000)).toBe(125);
  });
});

describe('durationTextOf', () => {
  test('a span the page can word reads as the page\'s duration text', () => {
    for (const milliseconds of [30_000, 135 * 60_000, 26 * 60 * 60_000]) {
      expect(durationTextOf(milliseconds, EXAMPLE_PAGE_LIMITS)).toBe(TimeUtil.formatDuration(milliseconds, EXAMPLE_PAGE_LIMITS) ?? 'a worded duration');
    }
  });

  test('a span that runs backwards, which names no duration, reads as empty text', () => {
    expect(TimeUtil.formatDuration(-180_000, EXAMPLE_PAGE_LIMITS)).toBeNull();
    expect(durationTextOf(-180_000, EXAMPLE_PAGE_LIMITS)).toBe('');
  });
});
