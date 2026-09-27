import type { TicketStatus }                       from '../@types/Ticket.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS } from '../constants/TicketMoveLegality.ts';

function ticketMoveIsLegal(currentStatus: TicketStatus, targetStatus: TicketStatus): boolean {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].includes(currentStatus);
}

export const TicketMoveUtil = { ticketMoveIsLegal } as const;
