/** The merge-queue mark on a ticket's row: set once its review passed, while it waits in review to land. Leaving in-review clears it. */
import type { Task }         from './@types/Task.ts';
import type { BoardRecords } from './BoardRecords.ts';
import { BoardRefusal }      from './BoardRefusal.ts';

export class MergeQueueMarks {
  constructor(private readonly records: BoardRecords) {}

  /** Queuing is refused outside in-review; clearing never is, so a refused landing can always take the mark back. */
  setTicketMergeQueued(ticketId: string, queued: boolean, at: string): Readonly<Task> | null {
    const ticket     = this.records.requireTicket(ticketId);
    const { status } = ticket.frontmatter;
    if (!queued) {
      const row = this.records.linkedTaskRecordOf(ticket) ?? null;
      if (row !== null) delete row.mergeQueued;
      return row;
    }
    if (status !== 'in-review') throw new BoardRefusal({ reason: 'merge-queue-of-a-ticket-not-in-review', ticketId, status });
    const row       = this.records.ensureTaskForTicket(ticket, at);
    row.mergeQueued = true;
    return row;
  }

  ticketIsMergeQueued(ticketId: string): boolean {
    const ticket = this.records.ticketRecordById(ticketId);
    return ticket !== undefined && this.records.linkedTaskRecordOf(ticket)?.mergeQueued === true;
  }
}
