/**
 * The header's figures, computed once from the islands at load: the four summary statistics and whether the page is still live. Comparing
 * a stamp with the viewer's day and the page's age with the clock are stated clock exceptions that decide only what the header prints.
 */

import { MILLISECONDS_PER_MINUTE }             from '../../../src/lib/local-time/LocalTimeUtil.ts';
import type { Task }                           from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketFrontmatter }              from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { DurationUnits, TimestampSlices } from '../../utils/TimeUtil.ts';
import { TimeUtil }                            from '../../utils/TimeUtil.ts';

/** Twice the CLI's five-minute write interval: a page older than this has missed a write and is a snapshot. */
export const LIVE_AGE_LIMIT_MILLISECONDS = 10 * MILLISECONDS_PER_MINUTE;

export interface HeaderStatistics {
  runningTaskCount:    number;
  /** Null when the payload carries no concurrency limit, and the header shows the running count alone. */
  agentLimit:          number | null;
  deliveredTodayCount: number;
  tokensToday:         number;
  waitingInQueueCount: number;
}

export interface HeaderStatisticsSource {
  tasks:             readonly Task[];
  tickets:           readonly Pick<TicketFrontmatter, 'status' | 'delivered'>[];
  agentLimit:        number | null;
  todayCalendarDate: string;
  slices:            TimestampSlices;
}

export interface PageFreshness {
  isLive:  boolean;
  ageText: string;
}

function taskIsRunning(task: Task): boolean {
  return task.status === 'in-progress' && task.end === null;
}

function statisticsOf(source: HeaderStatisticsSource): HeaderStatistics {
  const isToday = (stamp: string | null): boolean => stamp !== null && TimeUtil.stampIsFromDay(stamp, source.todayCalendarDate, source.slices);
  const tasksOfToday = source.tasks.filter((task) => taskIsRunning(task) || isToday(task.end));
  return {
    runningTaskCount:    source.tasks.filter(taskIsRunning).length,
    agentLimit:          source.agentLimit,
    deliveredTodayCount: source.tickets.filter((ticket) => isToday(ticket.delivered)).length,
    tokensToday:         tasksOfToday.reduce((total, task) => total + (task.tokens ?? 0), 0),
    waitingInQueueCount: source.tickets.filter((ticket) => ticket.status === 'pending').length,
  };
}

function ageTextOf(ageMilliseconds: number, units: DurationUnits): string {
  const ageMinutes = Math.floor(ageMilliseconds / MILLISECONDS_PER_MINUTE);
  if (ageMinutes < 1) {
    return 'just now';
  }
  if (ageMinutes < units.hourMinutes) {
    return `${ageMinutes} min ago`;
  }
  if (ageMinutes < units.dayMinutes) {
    return `${Math.floor(ageMinutes / units.hourMinutes)} h ago`;
  }
  const ageDays = Math.floor(ageMinutes / units.dayMinutes);
  return `${ageDays} ${ageDays === 1 ? 'day' : 'days'} ago`;
}

/** A page stamped in the future by a skewed clock reads as just generated, never as a negative age. */
function freshnessOf(generatedAtEpochMilliseconds: number, nowEpochMilliseconds: number, units: DurationUnits): PageFreshness {
  const ageMilliseconds = Math.max(0, nowEpochMilliseconds - generatedAtEpochMilliseconds);
  return {
    isLive:  ageMilliseconds < LIVE_AGE_LIMIT_MILLISECONDS,
    ageText: ageTextOf(ageMilliseconds, units),
  };
}

export const HeaderFigureUtil = {
  statisticsOf,
  freshnessOf,
} as const;
