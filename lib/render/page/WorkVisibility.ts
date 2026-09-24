/** Which tasks and tickets the page shows: work that has been done for longer than the window is hidden unless the viewer asked for all of it. */

import type {
  Task,
  TaskStatus,
  TicketFrontmatter,
  TicketStatus,
} from '../../constants/Types.ts';

export type WorkVisibility = 'recent' | 'all';

export const DEFAULT_WORK_VISIBILITY: WorkVisibility = 'recent';

// Done means merged: a `reviewed` row and a `done` ticket are awaiting merge, so they stay visible.
const DONE_TASK_STATUSES: readonly TaskStatus[]     = ['delivered', 'abandoned'];
const DONE_TICKET_STATUSES: readonly TicketStatus[] = ['delivered', 'abandoned'];

function epochMillisecondsOf(text: string | null): number | null {
  if (text === null || text === '') {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function doneLongerThan(doneAt: string | null, nowEpochMilliseconds: number, windowMilliseconds: number): boolean {
  const doneEpochMilliseconds = epochMillisecondsOf(doneAt);
  return doneEpochMilliseconds !== null && nowEpochMilliseconds - doneEpochMilliseconds > windowMilliseconds;
}

export function taskIsLongDone(task: Task, nowEpochMilliseconds: number, windowMilliseconds: number): boolean {
  return DONE_TASK_STATUSES.includes(task.status) && doneLongerThan(task.end ?? task.start, nowEpochMilliseconds, windowMilliseconds);
}

// `updated` rather than `finished`: `finished` is stamped when review starts, `updated` by the last transition.
export function ticketIsLongDone(ticket: TicketFrontmatter, nowEpochMilliseconds: number, windowMilliseconds: number): boolean {
  return DONE_TICKET_STATUSES.includes(ticket.status) && doneLongerThan(ticket.updated, nowEpochMilliseconds, windowMilliseconds);
}

export function workVisibilityFrom(value: unknown): WorkVisibility {
  return value === 'all' ? 'all' : DEFAULT_WORK_VISIBILITY;
}

export function workVisibilityStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}:visibility`;
}

export function hiddenWorkNoteText(hiddenTaskCount: number, hiddenTicketCount: number): string {
  const parts: string[] = [];
  if (hiddenTaskCount > 0) {
    parts.push(`${hiddenTaskCount} task${hiddenTaskCount === 1 ? '' : 's'}`);
  }
  if (hiddenTicketCount > 0) {
    parts.push(`${hiddenTicketCount} ticket${hiddenTicketCount === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? '' : `${parts.join(' · ')} hidden`;
}
