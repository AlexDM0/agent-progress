/**
 * A lane count tweens from its old figure to its new one and lands exactly on the new one. What matters: the sequence
 * only moves toward the target, ends on it, and a duration of 0 (reduced motion, or before the page is ready) shows
 * the final figure at once; a token the page cannot read counts as 0 rather than guessing a duration.
 */

import { describe, expect, test } from 'bun:test';
import { CountTweenUtil }         from './CountTweenUtil.ts';

const { durationMillisecondsOf, easedProgressOf, countAt } = CountTweenUtil;

describe('a motion token read as a duration', () => {
  test.each([
    ['milliseconds', '160ms', 160],
    ['seconds', '0.16s', 160],
    ['padded milliseconds', '  120ms ', 120],
    ['zero', '0ms', 0],
    ['an empty token', '', 0],
    ['no CSS time', 'fast', 0],
  ])('reads %s', (_description, tokenValue, expected) => {
    expect(durationMillisecondsOf(tokenValue)).toBe(expected);
  });
});

describe('the tween from 18 to 3 over 160 ms', () => {
  const DURATION_MILLISECONDS = 160;
  const FRAME_MILLISECONDS    = 16;
  const frameCounts = Array.from({ length: DURATION_MILLISECONDS / FRAME_MILLISECONDS + 1 }, (_unused, frame) =>
    countAt(18, 3, easedProgressOf(frame * FRAME_MILLISECONDS, DURATION_MILLISECONDS)));

  test('starts on the old figure and ends exactly on the new one', () => {
    expect(frameCounts[0]).toBe(18);
    expect(frameCounts.at(-1)).toBe(3);
  });

  test('never moves away from the new figure', () => {
    for (let i = 1; i < frameCounts.length; i++) {
      expect(frameCounts[i] ?? 0).toBeLessThanOrEqual(frameCounts[i - 1] ?? 0);
    }
  });

  test('eases out: more than half the distance is covered in the first third', () => {
    expect(countAt(0, 100, easedProgressOf(DURATION_MILLISECONDS / 3, DURATION_MILLISECONDS))).toBeGreaterThan(50);
  });

  test('stays on the new figure past its duration', () => {
    expect(countAt(18, 3, easedProgressOf(DURATION_MILLISECONDS * 2, DURATION_MILLISECONDS))).toBe(3);
  });
});

describe('a duration of 0', () => {
  test('is finished at once, so the new figure shows on the first frame', () => {
    expect(countAt(18, 3, easedProgressOf(0, 0))).toBe(3);
  });
});
