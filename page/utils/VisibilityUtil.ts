/** Which done tasks and tickets count as long done, and so are hidden unless the viewer asked for all work. */

import type { Task }                                      from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketFrontmatter }                         from '../../src/lib/tracker-model/@types/Ticket.ts';
import { SETTLED_TASK_STATUSES, SETTLED_TICKET_STATUSES } from '../../src/lib/tracker-model/constants/Statuses.ts';
import { TimeUtil }                                       from './TimeUtil.ts';

// Comparing with now is a stated clock exception that decides only what the page shows, never what is stored.
function doneLongerThan(doneAt: string | null, nowEpochMilliseconds: number, windowMilliseconds: number): boolean {
  const doneEpochMilliseconds = TimeUtil.epochMillisecondsOf(doneAt);
  return doneEpochMilliseconds !== null && nowEpochMilliseconds - doneEpochMilliseconds > windowMilliseconds;
}

// Done means merged: a `reviewed` row and a `reviewed` ticket are awaiting merge, so they stay visible.
function taskIsLongDone(task: Task, nowEpochMilliseconds: number, windowMilliseconds: number): boolean {
  return SETTLED_TASK_STATUSES.includes(task.status) && doneLongerThan(task.end ?? task.start, nowEpochMilliseconds, windowMilliseconds);
}

// `updated` rather than `finished`: `finished` is stamped when review starts, `updated` by the last transition.
function ticketIsLongDone(ticket: TicketFrontmatter, nowEpochMilliseconds: number, windowMilliseconds: number): boolean {
  return SETTLED_TICKET_STATUSES.includes(ticket.status) && doneLongerThan(ticket.updated, nowEpochMilliseconds, windowMilliseconds);
}

export const VisibilityUtil = {
  taskIsLongDone,
  ticketIsLongDone,
} as const;
