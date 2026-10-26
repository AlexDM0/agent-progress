/** A ticket's links to the tickets behind it: the delivered ticket whose change introduced a bug, and the ticket whose review found it. */
import type { TicketChanged }     from './@types/BoardChanges.ts';
import type { TicketFrontmatter } from './@types/Ticket.ts';
import type { BoardRecords }      from './BoardRecords.ts';
import { BoardRefusal }           from './BoardRefusal.ts';

export class TicketLinks {
  constructor(private readonly records: BoardRecords) {}

  /** A `null` cause removes the key, so the file reads as a bug nobody traced. */
  setIntroducedBy(ticketId: string, causeTicketId: string | null, at: string): TicketChanged {
    const ticket = this.records.requireTicket(ticketId);
    if (causeTicketId === null) {
      delete ticket.frontmatter.introducedBy;
    } else {
      this.refuseAnUnworkableCause(ticket.frontmatter, causeTicketId);
      ticket.frontmatter.introducedBy = causeTicketId;
    }
    this.records.markChanged(ticket);
    const fields = causeTicketId === null ? {} : { introducedBy: causeTicketId };
    return { logged: [this.records.logger.log({ kind: 'ticket-introduced-by-set', ticketId, fields }, at)], ticket };
  }

  refuseUnworkableLinksOfAFiledTicket(frontmatter: Readonly<TicketFrontmatter>): void {
    if (frontmatter.introducedBy !== undefined) this.refuseAnUnworkableCause(frontmatter, frontmatter.introducedBy);
    if (frontmatter.foundInReview !== undefined && this.records.ticketRecordById(frontmatter.foundInReview) === undefined) {
      throw new BoardRefusal({ reason: 'unknown-linked-ticket', missingTicketId: frontmatter.foundInReview });
    }
  }

  /** Only shipped work lets a bug escape, so the cause must be delivered. */
  private refuseAnUnworkableCause(frontmatter: Readonly<TicketFrontmatter>, causeTicketId: string): void {
    const ticketId = frontmatter.id;
    if (frontmatter.type !== 'bug') throw new BoardRefusal({ reason: 'introduced-by-on-a-non-bug', ticketId, type: frontmatter.type });
    if (causeTicketId === ticketId) throw new BoardRefusal({ reason: 'introduced-by-itself', ticketId });
    const cause = this.records.ticketRecordById(causeTicketId);
    if (cause === undefined) throw new BoardRefusal({ reason: 'unknown-linked-ticket', missingTicketId: causeTicketId });
    const { status } = cause.frontmatter;
    if (status !== 'delivered') throw new BoardRefusal({
      reason: 'introduced-by-an-undelivered-ticket', ticketId, causeTicketId, status
    });
  }
}
