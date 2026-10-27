/** The status ladders as runtime tuples, since nothing can enumerate a type, and the subsets the rules single out. */
import type { TaskStatus }   from '../@types/Task.ts';
import type { TicketStatus } from '../@types/Ticket.ts';

export const TASK_STATUSES = ['pending', 'in-progress', 'paused', 'in-review', 're-review', 'reviewed', 'delivered', 'abandoned'] as const;

export const TICKET_STATUSES = ['draft', 'pending', 'in-progress', 'in-review', 'reviewed', 'delivered', 'abandoned'] as const;

/** Nothing more will happen to a row or ticket in one of these: it is completed work, never open work. */
export const SETTLED_TASK_STATUSES: readonly TaskStatus[] = ['delivered', 'abandoned'];

/** A settled ticket is never built, reviewed or held again, so neither its agents nor a hold on it can be changed. */
export const SETTLED_TICKET_STATUSES: readonly TicketStatus[] = ['delivered', 'abandoned'];

/** No agent has claimed a ticket in one of these, so an edit cannot change work under way. */
export const TICKET_STATUSES_EDITABLE_WITHOUT_FORCE: readonly TicketStatus[] = ['draft', 'pending'];

/** Abandoned is left out on purpose: the work a dependent ticket waited for never happened. */
export const TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY: readonly TicketStatus[] = ['reviewed', 'delivered'];

/** Nothing is built toward a ticket in one of these, so the dependencies it lists are history and it waits on none of them. */
export const TICKET_STATUSES_THAT_CLOSE_A_TICKET: readonly TicketStatus[] = ['reviewed', 'delivered', 'abandoned'];
