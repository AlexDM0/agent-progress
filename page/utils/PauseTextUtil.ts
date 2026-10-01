/**
 * How long a paused build has been paused, in the words every view of it shares: "since 11:45 · 1h 51m". Measuring the pause against the
 * clock is a stated clock exception that decides only what the page prints.
 */

import type { Task }                           from '../../src/lib/tracker-model/@types/Task.ts';
import type { DurationUnits, TimestampSlices } from './TimeUtil.ts';
import { TimeUtil }                            from './TimeUtil.ts';

export interface PauseTextFormat {
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  slices:               TimestampSlices & DurationUnits;
}

/** The newest `paused` phase, since a build paused, resumed and paused again counts from its last pause. */
function pausedStampOf(row: Pick<Task, 'history'> | null): string | null {
  const pausedAt = (row?.history ?? []).findLast((phase) => phase.status === 'paused')?.at;
  return pausedAt === undefined || pausedAt === '' ? null : pausedAt;
}

/** `null` without a pause stamp; the duration is left off when the stamp is unreadable or later than now, as a backfilled `--at` can be. */
function pauseTextOf(row: Pick<Task, 'history'> | null, format: PauseTextFormat): string | null {
  const pausedAt = pausedStampOf(row);
  if (pausedAt === null) {
    return null;
  }
  const since                     = `since ${TimeUtil.shortStampText(pausedAt, format.todayCalendarDate, format.slices)}`;
  const pausedAtEpochMilliseconds = TimeUtil.epochMillisecondsOf(pausedAt);
  const duration                  = pausedAtEpochMilliseconds === null
    ? null
    : TimeUtil.formatDuration(format.nowEpochMilliseconds - pausedAtEpochMilliseconds, format.slices);
  return duration === null ? since : `${since} · ${duration}`;
}

export const PauseTextUtil = {
  pausedStampOf,
  pauseTextOf,
} as const;
