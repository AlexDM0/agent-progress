/** The status ladders as runtime tuples, since nothing can enumerate a type, and the subsets the rules single out. */
import type { TaskStatus }   from '../@types/Task.ts';
import type { TicketStatus } from '../@types/Ticket.ts';

export const TASK_STATUSES = ['pending', 'running', 'paused', 'finished', 're-review', 'reviewed', 'delivered', 'abandoned'] as const;

export const TICKET_STATUSES = ['pending', 'in-progress', 'in-review', 'reviewed', 'delivered', 'abandoned'] as const;

/** `in-review` → `finished` reads backwards until you notice the two ladders are named from opposite ends. */
export const TASK_STATUS_FOR_TICKET_STATUS: Record<TicketStatus, TaskStatus> = {
  'pending':     'pending',
  'in-progress': 'running',
  'in-review':   'finished',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
  'abandoned':   'abandoned',
};

/** Nothing more will happen to a row or ticket in one of these: the page counts them as work completed, and `status` hides them. */
export const SETTLED_TASK_STATUSES: readonly TaskStatus[] = ['delivered', 'abandoned'];

export const SETTLED_TICKET_STATUSES: readonly TicketStatus[] = ['delivered', 'abandoned'];

/** Abandoned is left out on purpose: the work a dependent ticket waited for never happened. */
export const TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY: readonly TicketStatus[] = ['reviewed', 'delivered'];

/** A ticket in one of these is never built or reviewed again, so neither its agents nor a hold on it can be changed. */
export const TICKET_STATUSES_NO_AGENT_WORKS_AGAIN: readonly TicketStatus[] = ['delivered', 'abandoned'];
