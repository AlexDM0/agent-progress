/**
 * The elapsed-time words of the Agents view. What matters: each unit boundary, a stamp in the future reading `0s` rather than a negative
 * span, and a missing or unreadable stamp reading no time at all.
 */
import { describe, expect, test } from 'bun:test';

import { ElapsedTimeUtil } from './ElapsedTimeUtil.ts';

describe('ElapsedTimeUtil', () => {
  test('seconds, minutes and hours each carry the units below them, zero-padded', () => {
    expect(ElapsedTimeUtil.formatElapsed(42_000)).toBe('42s');
    expect(ElapsedTimeUtil.formatElapsed(252_000)).toBe('4m 12s');
    expect(ElapsedTimeUtil.formatElapsed(3_737_000)).toBe('1h 02m 17s');
    expect(ElapsedTimeUtil.formatElapsed(-5_000)).toBe('0s');
  });

  test('the time since a stamp, and none for a missing or unreadable one', () => {
    const now = new Date('2026-10-29T20:00:12Z');
    expect(ElapsedTimeUtil.elapsedSinceText('2026-10-29T20:00:00Z', now)).toBe('12s');
    expect(ElapsedTimeUtil.elapsedSinceText(null, now)).toBeNull();
    expect(ElapsedTimeUtil.elapsedSinceText('not a stamp', now)).toBeNull();
  });
});
