import { TicketJsonUtil } from '../../../src/adapters/utils/TicketJsonUtil.ts';
import type { Ticket }    from '../../../src/lib/tracker-model/@types/Ticket.ts';

/** The priority is always spelled out, so a script never has to know that an absent key means normal. */
function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...TicketJsonUtil.ticketDocumentOf(ticket), body: ticket.body };
}

export const TicketOutputUtil = { ticketAsJson } as const;
