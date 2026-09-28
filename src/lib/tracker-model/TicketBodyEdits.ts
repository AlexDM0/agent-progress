/**
 * A ticket body replaced or appended to, leaving the frontmatter and its `updated` stamp alone: only a transition stamps it. The new text is
 * written in the line ending the body already uses, so an edit never leaves a file with two.
 */
import type { LineEnding, Ticket } from './@types/Ticket.ts';
import type { BoardRecords }       from './BoardRecords.ts';

export interface TicketBodyEdit {
  text:    string;
  appends: boolean;
}

export interface TicketBodyEdited {
  ticket:  Readonly<Ticket>;
  /** False when the body already read exactly so, an empty append included; the ticket is then not written. */
  changed: boolean;
}

const CARRIAGE_RETURN_LINE_ENDING: LineEnding = '\r\n';
const LINE_FEED: LineEnding                   = '\n';
const ANY_LINE_ENDING_PATTERN                 = /\r?\n/g;

export class TicketBodyEdits {
  constructor(private readonly records: BoardRecords) {}

  editTicketBody(ticketId: string, edit: TicketBodyEdit): TicketBodyEdited {
    const ticket     = this.records.requireTicket(ticketId);
    const lineEnding = lineEndingOfBody(ticket);
    const text       = edit.text.replace(ANY_LINE_ENDING_PATTERN, lineEnding);
    const body       = edit.appends ? appendedBodyOf(ticket.body, text, lineEnding) : text;
    if (body === ticket.body) return { ticket, changed: false };

    ticket.body = body;
    this.records.markChanged(ticket);
    return { ticket, changed: true };
  }
}

/** The body's own first line ending decides; a body holding none takes the frontmatter's. */
function lineEndingOfBody(ticket: Readonly<Ticket>): LineEnding {
  const firstLineFeedIndex = ticket.body.indexOf(LINE_FEED);
  if (firstLineFeedIndex === -1) return ticket.lineEnding ?? LINE_FEED;
  return ticket.body[firstLineFeedIndex - 1] === '\r' ? CARRIAGE_RETURN_LINE_ENDING : LINE_FEED;
}

function appendedBodyOf(body: string, appendedText: string, lineEnding: LineEnding): string {
  if (appendedText === '') return body;
  if (body === '' || body.endsWith(LINE_FEED)) return `${body}${appendedText}`;
  return `${body}${lineEnding}${appendedText}`;
}
