/** The vocabularies of a ticket's own fields, the priority an absent key reads as, and the width a ticket id is padded to. */
import type { TicketPriority } from '../@types/Ticket.ts';

export const TICKET_TYPES = ['bug', 'change', 'feature'] as const;

export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;

export const DEFAULT_TICKET_PRIORITY: TicketPriority = 'normal';

export const TICKET_ID_DIGITS = 3;
