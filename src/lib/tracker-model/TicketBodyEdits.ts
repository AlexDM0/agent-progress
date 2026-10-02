/**
 * A ticket's title and body edited, leaving every other frontmatter value and its `updated` stamp alone: only a transition stamps it. A new
 * title renames the ticket's own row and the body's generated heading, never a review bar, whose name records the title it was started under.
 */
import type { Logged }           from './@types/BoardChanges.ts';
import type { Ticket }           from './@types/Ticket.ts';
import type { BoardRecords }     from './BoardRecords.ts';
import type { MarkdownBodyEdit } from './utils/MarkdownBodyUtil.ts';
import { MarkdownBodyUtil }      from './utils/MarkdownBodyUtil.ts';
import { TicketChartUtil }       from './utils/TicketChartUtil.ts';

export interface TicketEdit {
  title?: string;
  body?:  MarkdownBodyEdit;
}

export interface TicketEdited extends Logged {
  ticket:  Readonly<Ticket>;
  /** False when the title and body already read exactly so, an empty append included; the ticket is then not written. */
  changed: boolean;
}

const LINE_FEED = '\n';

function generatedHeadingOf(ticketId: string, title: string): string {
  return `# ${ticketId} — ${title}`;
}

/** Only a first line reading exactly as `ticket add` generates it is rewritten, keeping its line ending; a hand-changed heading is the author's. */
function bodyWithHeadingRetitled(body: string, ticketId: string, previousTitle: string, title: string): string {
  const lineFeedIndex  = body.indexOf(LINE_FEED);
  const firstLineEnd   = lineFeedIndex === -1 ? body.length : lineFeedIndex;
  const headingEnd     = body[firstLineEnd - 1] === '\r' ? firstLineEnd - 1 : firstLineEnd;
  if (body.slice(0, headingEnd) !== generatedHeadingOf(ticketId, previousTitle)) return body;
  return `${generatedHeadingOf(ticketId, title)}${body.slice(headingEnd)}`;
}

export class TicketBodyEdits {
  constructor(private readonly records: BoardRecords) {}

  /** The heading is retitled before the body edit applies, so a replacement is written as given and an append lands on the retitled body. */
  editTicket(ticketId: string, edit: TicketEdit, at: string): TicketEdited {
    const ticket          = this.records.requireTicket(ticketId);
    const previousTitle   = ticket.frontmatter.title;
    const title           = edit.title ?? previousTitle;
    const retitled        = title !== previousTitle;
    const retitledBody    = retitled ? bodyWithHeadingRetitled(ticket.body, ticketId, previousTitle, title) : ticket.body;
    const body            = edit.body === undefined ? retitledBody : MarkdownBodyUtil.editedBodyOf({ ...ticket, body: retitledBody }, edit.body);
    if (!retitled && body === ticket.body) return { logged: [], ticket, changed: false };

    ticket.body = body;
    this.records.markChanged(ticket);
    if (!retitled) return { logged: [], ticket, changed: true };

    ticket.frontmatter.title = title;
    const ownRow = this.records.linkedTaskRecordOf(ticket);
    if (ownRow !== undefined) ownRow.name = TicketChartUtil.rowNameOf(ticket.frontmatter);
    return {
      logged:  [this.records.logger.log({ kind: 'ticket-retitled', ticketId, fields: { from: previousTitle, to: title } }, at)],
      ticket,
      changed: true,
    };
  }
}
