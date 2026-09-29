/**
 * The activity banner's figures: which rows are agents at work, whether each builds or reviews, what the banner calls it and how long it has
 * run. Measuring a running row against the clock is a stated clock exception that decides only what the banner prints.
 */

import type { Task }          from '../../../src/lib/tracker-model/@types/Task.ts';
import type { DurationUnits } from '../../utils/TimeUtil.ts';
import { TimeUtil }           from '../../utils/TimeUtil.ts';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE      = 60;

const LEADING_TASK_ID_PATTERN = /^#\d+\s+/;

export type ActivityKind = 'building' | 'reviewing';

export interface ActivityEntry {
  taskId:                 number;
  kind:                   ActivityKind;
  /** The padded id of the ticket the agent builds or reviews, or null for a free-standing row. */
  ticketId:               string | null;
  title:                  string;
  /** Null when the running row carries no readable start, which the banner orders last and shows without a time. */
  startEpochMilliseconds: number | null;
}

type ActivityTask = Pick<Task, 'id' | 'name' | 'status' | 'start' | 'end' | 'ticket' | 'reviewOf'>;

function taskIsRunning(task: Pick<Task, 'status' | 'end'>): boolean {
  return task.status === 'in-progress' && task.end === null;
}

/** A row reviews only when it names the ticket it reviews: a name that merely reads like a review bar is never a link. */
function activityKindOf(task: Pick<Task, 'reviewOf'>): ActivityKind {
  return task.reviewOf === undefined ? 'building' : 'reviewing';
}

function ticketIdOf(task: Pick<Task, 'ticket' | 'reviewOf'>): string | null {
  return task.reviewOf ?? task.ticket;
}

function bannerTitleOf(task: Pick<Task, 'name' | 'ticket' | 'reviewOf'>, ticketTitleById: ReadonlyMap<string, string>): string {
  const ticketId = ticketIdOf(task);
  const ticketTitle = ticketId === null ? undefined : ticketTitleById.get(ticketId);
  return ticketTitle ?? task.name.replace(LEADING_TASK_ID_PATTERN, '');
}

function startOrder(start: number | null): number {
  return start ?? Number.POSITIVE_INFINITY;
}

/** Every running row, longest-running first; rows that started together keep their id order. */
function activityEntriesOf(tasks: readonly ActivityTask[], tickets: readonly { id: string; title: string }[]): ActivityEntry[] {
  const ticketTitleById = new Map(tickets.map((ticket) => [ticket.id, ticket.title]));
  return tasks
    .filter(taskIsRunning)
    .map((task) => ({
      taskId:                 task.id,
      kind:                   activityKindOf(task),
      ticketId:               ticketIdOf(task),
      title:                  bannerTitleOf(task, ticketTitleById),
      startEpochMilliseconds: TimeUtil.epochMillisecondsOf(task.start),
    }))
    .sort((a, b) => startOrder(a.startEpochMilliseconds) - startOrder(b.startEpochMilliseconds) || a.taskId - b.taskId);
}

function padToTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** `42s`, `4m 12s`, `1h 02m 17s`; a start after the reference moment, which a skewed clock can give, reads as `0s`. */
function formatElapsed(milliseconds: number, units: DurationUnits): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / MILLISECONDS_PER_SECOND));
  const secondsPerHour = units.hourMinutes * SECONDS_PER_MINUTE;
  const hours   = Math.floor(totalSeconds / secondsPerHour);
  const minutes = Math.floor((totalSeconds % secondsPerHour) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (hours > 0) {
    return `${hours}h ${padToTwoDigits(minutes)}m ${padToTwoDigits(seconds)}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${padToTwoDigits(seconds)}s`;
  }
  return `${seconds}s`;
}

/** Empty for an entry without a start. The reference moment is the clock while the page is live and its generation once it is a snapshot. */
function elapsedTextOf(entry: Pick<ActivityEntry, 'startEpochMilliseconds'>, referenceEpochMilliseconds: number, units: DurationUnits): string {
  return entry.startEpochMilliseconds === null ? '' : formatElapsed(referenceEpochMilliseconds - entry.startEpochMilliseconds, units);
}

export const ActivityBannerUtil = {
  activityKindOf,
  bannerTitleOf,
  activityEntriesOf,
  formatElapsed,
  elapsedTextOf,
} as const;
