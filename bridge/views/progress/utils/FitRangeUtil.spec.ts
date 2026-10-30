/**
 * The Fit range of the Bridge's chart, which spans every row. The cases that matter: Fit starts at the earliest start minus the margin
 * and ends at now plus the same margin; the margin is a share of the span with a floor; and a chart with no started row still spans its
 * margin around now.
 */
import { describe, expect, test } from 'bun:test';

import { FitRangeUtil } from './FitRangeUtil.ts';

const MINUTE_MILLISECONDS    = 60_000;
const DAY_MILLISECONDS       = 24 * 60 * MINUTE_MILLISECONDS;
const NOW_EPOCH_MILLISECONDS = Date.parse('2026-09-25T13:36:00+02:00');

describe('fittedSpanOf', () => {
  test('starts at the earliest start minus the margin and ends at now plus the same margin', () => {
    const span = FitRangeUtil.fittedSpanOf(
      [{ start: '2026-09-15T13:36:00+02:00' }, { start: '2026-09-20T13:36:00+02:00' }, { start: null }],
      NOW_EPOCH_MILLISECONDS,
    );
    const marginMilliseconds = 10 * DAY_MILLISECONDS * 0.03;

    expect(span.earliestStartEpochMilliseconds).toBe(NOW_EPOCH_MILLISECONDS - 10 * DAY_MILLISECONDS);
    expect(span.marginMilliseconds).toBeCloseTo(marginMilliseconds);
    expect(span.fromEpochMilliseconds).toBeCloseTo(span.earliestStartEpochMilliseconds - marginMilliseconds);
    expect(span.toEpochMilliseconds).toBeCloseTo(NOW_EPOCH_MILLISECONDS + marginMilliseconds);
  });

  test('spans the margin floor around now when no row has started', () => {
    const span = FitRangeUtil.fittedSpanOf([{ start: null }], NOW_EPOCH_MILLISECONDS);

    expect([span.fromEpochMilliseconds, span.toEpochMilliseconds]).toEqual([
      NOW_EPOCH_MILLISECONDS - 5 * MINUTE_MILLISECONDS,
      NOW_EPOCH_MILLISECONDS + 5 * MINUTE_MILLISECONDS,
    ]);
  });
});

test('the margin never falls below its floor on a short span', () => {
  expect(FitRangeUtil.fitMarginMillisecondsOf(NOW_EPOCH_MILLISECONDS - 10 * MINUTE_MILLISECONDS, NOW_EPOCH_MILLISECONDS)).toBe(5 * MINUTE_MILLISECONDS);
});
