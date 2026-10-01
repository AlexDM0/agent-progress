/** A ticket body replaced or appended to, leaving the frontmatter and its `updated` stamp alone: only a transition stamps it. */
import type { Ticket }           from './@types/Ticket.ts';
import type { BoardRecords }     from './BoardRecords.ts';
import type { MarkdownBodyEdit } from './utils/MarkdownBodyUtil.ts';
import { MarkdownBodyUtil }      from './utils/MarkdownBodyUtil.ts';

export type TicketBodyEdit = MarkdownBodyEdit;

export interface TicketBodyEdited {
  ticket:  Readonly<Ticket>;
  /** False when the body already read exactly so, an empty append included; the ticket is then not written. */
  changed: boolean;
}

export class TicketBodyEdits {
  constructor(private readonly records: BoardRecords) {}

  editTicketBody(ticketId: string, edit: TicketBodyEdit): TicketBodyEdited {
    const ticket = this.records.requireTicket(ticketId);
    const body   = MarkdownBodyUtil.editedBodyOf(ticket, edit);
    if (body === ticket.body) return { ticket, changed: false };

    ticket.body = body;
    this.records.markChanged(ticket);
    return { ticket, changed: true };
  }
}
