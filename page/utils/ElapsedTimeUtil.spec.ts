/**
 * The elapsed time the activity banner and the live Kanban cards print. The cases that matter: the design's three shapes with zero-padded
 * inner units, a start after the reference reading as `0s`, and the label going before the time.
 */

import { describe, expect, test } from 'bun:test';
import { EXAMPLE_PAGE_LIMITS }    from '../testing/PageLimitsFixture.ts';
import { ElapsedTimeUtil }        from './ElapsedTimeUtil.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR   = 60 * MINUTE;

describe('formatElapsed', () => {
  test.each([
    [0, '0s'],
    [42 * SECOND, '42s'],
    [4 * MINUTE + 12 * SECOND, '4m 12s'],
    [51 * MINUTE + 3 * SECOND, '51m 03s'],
    [HOUR + 2 * MINUTE + 17 * SECOND, '1h 02m 17s'],
    [26 * HOUR + 5 * SECOND, '26h 00m 05s'],
    [999, '0s'],
    [-5 * SECOND, '0s'],
  ])('%p ms prints %p', (milliseconds, expected) => {
    expect(ElapsedTimeUtil.formatElapsed(milliseconds, EXAMPLE_PAGE_LIMITS)).toBe(expected);
  });
});

describe('labelledElapsedTextOf', () => {
  test('puts the label before the time from the start to the reference moment', () => {
    const start = 1_000_000;
    expect(ElapsedTimeUtil.labelledElapsedTextOf('building', start, start + 2 * HOUR + 36 * MINUTE + 13 * SECOND, EXAMPLE_PAGE_LIMITS)).toBe('building 2h 36m 13s');
    expect(ElapsedTimeUtil.labelledElapsedTextOf('2nd round', start, start + 18 * SECOND, EXAMPLE_PAGE_LIMITS)).toBe('2nd round 18s');
  });
});
