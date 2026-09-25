import type { TicketStatus } from '../../src/lib/tracker-model/@types/Ticket.ts';

export const CLOSED_TICKET_STATUSES: readonly TicketStatus[] = ['reviewed', 'delivered', 'abandoned'];
