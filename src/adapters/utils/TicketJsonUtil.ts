import type { Ticket, TicketPriority } from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }          from '../../lib/tracker-model/utils/TicketDefaultsUtil.ts';

/** The priority and epics are spelled out even where the file leaves them out, so a script never has to know what an absent key means. */
function ticketDocumentOf(ticket: Ticket): Ticket['frontmatter'] & { priority: TicketPriority; epics: string[]; filePath: string } {
  return {
    ...ticket.frontmatter,
    priority: TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter),
    epics:    ticket.frontmatter.epics ?? [],
    filePath: ticket.filePath,
  };
}

/** What the ticket subcommands print under `--json`: the ticket document with the body appended last. */
function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...ticketDocumentOf(ticket), body: ticket.body };
}

export const TicketJsonUtil = { ticketAsJson, ticketDocumentOf } as const;
