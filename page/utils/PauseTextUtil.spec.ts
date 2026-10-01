/**
 * The pause text the Kanban card, the Tickets table and the detail panel share. What matters: it counts from the newest pause, shortens the
 * stamp by the page's one rule (clock today, month and day before), and drops only the duration when the stamp lies after now.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../../src/lib/tracker-model/@types/Task.ts';
import { EXAMPLE_PAGE_LIMITS }    from '../testing/PageLimitsFixture.ts';
import type { PauseTextFormat }   from './PauseTextUtil.ts';
import { PauseTextUtil }          from './PauseTextUtil.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const FORMAT: PauseTextFormat = {
  nowEpochMilliseconds: EXAMPLE_NOW,
  todayCalendarDate:    EXAMPLE_TODAY,
  slices:               EXAMPLE_PAGE_LIMITS,
};

function rowWithHistory(history: NonNullable<Task['history']>): Pick<Task, 'history'> {
  return { history };
}

describe('the pause stamp', () => {
  test('is the newest paused phase, after a resume and a second pause', () => {
    const row = rowWithHistory([
      { status: 'paused', at: '2026-09-25T09:00:00+02:00' },
      { status: 'in-progress', at: '2026-09-25T09:30:00+02:00' },
      { status: 'paused', at: '2026-09-25T11:45:00+02:00' },
    ]);

    expect(PauseTextUtil.pausedStampOf(row)).toBe('2026-09-25T11:45:00+02:00');
  });

  test('is null without a row, a history or a paused phase', () => {
    expect(PauseTextUtil.pausedStampOf(null)).toBeNull();
    expect(PauseTextUtil.pausedStampOf({})).toBeNull();
    expect(PauseTextUtil.pausedStampOf(rowWithHistory([{ status: 'in-progress', at: '2026-09-25T09:00:00+02:00' }]))).toBeNull();
  });
});

describe('the pause text', () => {
  test('reads the clock and the time paused for a pause today', () => {
    expect(PauseTextUtil.pauseTextOf(rowWithHistory([{ status: 'paused', at: '2026-09-25T11:45:00+02:00' }]), FORMAT)).toBe('since 11:45 · 1h 51m');
  });

  test('names the month and day of a pause on an earlier day', () => {
    expect(PauseTextUtil.pauseTextOf(rowWithHistory([{ status: 'paused', at: '2026-09-24T13:00:00+02:00' }]), FORMAT)).toBe('since 09-24 13:00 · 1d');
  });

  test('keeps the since but drops the duration for a pause stamped after now', () => {
    expect(PauseTextUtil.pauseTextOf(rowWithHistory([{ status: 'paused', at: '2026-09-25T14:00:00+02:00' }]), FORMAT)).toBe('since 14:00');
  });

  test('is null for a row with no pause stamp', () => {
    expect(PauseTextUtil.pauseTextOf(rowWithHistory([]), FORMAT)).toBeNull();
  });
});
