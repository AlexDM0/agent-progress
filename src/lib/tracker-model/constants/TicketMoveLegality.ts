import type { TicketStatus } from '../@types/Ticket.ts';

/**
 * Read as "to reach the key, the ticket has to be in one of these"; no row holds its own key, so a move to the current
 * status is never legal. A repeat review pass is the one move deliberately outside this table.
 */
export const LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS: Record<TicketStatus, readonly TicketStatus[]> = {
  'pending':     ['in-progress', 'in-review', 'reviewed', 'delivered', 'abandoned'],
  'in-progress': ['pending', 'in-review'],
  'in-review':   ['in-progress'],
  'reviewed':    ['in-progress', 'in-review'],
  'delivered':   ['reviewed'],
  'abandoned':   ['pending', 'in-progress', 'in-review', 'reviewed'],
};

export function ticketMoveIsLegal(currentStatus: TicketStatus, targetStatus: TicketStatus): boolean {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].includes(currentStatus);
}
