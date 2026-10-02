import type { Ticket, TicketPriority } from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketBodyHashUtil }          from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import { TicketDefaultsUtil }          from '../../lib/tracker-model/utils/TicketDefaultsUtil.ts';

type TicketDocument = Ticket['frontmatter'] & { priority: TicketPriority; epics: string[]; bodyChangedSinceClaim?: boolean; filePath: string };

/**
 * The priority and epics are spelled out even where the file leaves them out, so a script never has to know what an absent key means.
 * `bodyChangedSinceClaim` is present once the ticket was claimed or started: a hash of the body now against the one the claim recorded.
 */
function ticketDocumentOf(ticket: Ticket): TicketDocument {
  const bodyChangedSinceClaim = TicketBodyHashUtil.bodyChangedSinceClaimOf(ticket);
  return {
    ...ticket.frontmatter,
    priority: TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter),
    epics:    ticket.frontmatter.epics ?? [],
    ...(bodyChangedSinceClaim === undefined ? {} : { bodyChangedSinceClaim }),
    filePath: ticket.filePath,
  };
}

/** What the ticket subcommands print under `--json`: the ticket document with the body appended last. */
function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...ticketDocumentOf(ticket), body: ticket.body };
}

export const TicketJsonUtil = { ticketAsJson, ticketDocumentOf } as const;
