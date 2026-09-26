/** The board rules the page still derives from the payload by itself. */

import type { DisplayState, Task } from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }       from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketNumberUtil }        from '../../src/shared/utils/TicketNumberUtil.ts';
import type { KanbanCard }         from '../@types/KanbanCard.ts';

function ownRowOf(ticketId: string, tasks: readonly Task[]): Task | null {
  return tasks.find((task) => task.ticket === ticketId) ?? null;
}

function rowStateFor(task: Pick<Task, 'status'>, ticketStatus: TicketStatus | null): DisplayState {
  return task.status === 'in-review' && ticketStatus === 'in-review' ? 'reviewing' : task.status;
}

// Rows written before the review stamp existed carry none; a delivered ticket had to pass `reviewed`, so its row counts as reviewed.
function deliveredAfterReview(task: Task, ticketStatus: TicketStatus | null): boolean {
  return task.status === 'delivered' && (task.reviewed !== undefined || ticketStatus === 'delivered');
}

function cardCarriesReviewedMark(card: KanbanCard): boolean {
  return card.ownRow !== null && deliveredAfterReview(card.ownRow, card.ticket.status);
}

/** Oldest first by filing order, which is the row id: nothing here compares two clocks to decide an order. */
function reviewRowsOf(ticketId: string, tasks: readonly Task[]): Task[] {
  const ticketNumber = Number(ticketId);
  return tasks
    .filter((task) => task.ticket === null && TicketNumberUtil.reviewedTicketNumberOf(task) === ticketNumber)
    .toSorted((a, b) => a.id - b.id);
}

export const BoardRulesUtil = {
  ownRowOf,
  rowStateFor,
  deliveredAfterReview,
  cardCarriesReviewedMark,
  reviewRowsOf,
} as const;
