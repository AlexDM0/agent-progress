import type { Ticket, TicketPriority } from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }          from '../../lib/tracker-model/utils/TicketDefaultsUtil.ts';

/** The priority is spelled out even where the file leaves it to the default, so a script never has to know what an absent key means. */
function ticketDocumentOf(ticket: Ticket): Ticket['frontmatter'] & { priority: TicketPriority; filePath: string } {
  return { ...ticket.frontmatter, priority: TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter), filePath: ticket.filePath };
}

export const TicketJsonUtil = { ticketDocumentOf } as const;
