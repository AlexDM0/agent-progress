/** How the Board's rows and tickets read on the chart: which rows belong to a ticket, whether a record is settled, and its display state. */
import type { DisplayState, Task, TaskStatus }            from './@types/Task.ts';
import type { Ticket, TicketStatus }                      from './@types/Ticket.ts';
import type { BoardRecords }                              from './BoardRecords.ts';
import type { ReviewBars }                                from './ReviewBars.ts';
import { SETTLED_TASK_STATUSES, SETTLED_TICKET_STATUSES } from './constants/Statuses.ts';

export class DisplayQueries {
  constructor(
    private readonly records: BoardRecords,
    private readonly reviewBars: ReviewBars,
  ) {}

  /** Every row whose `reviewOf` is the ticket, a ticket-owned one included, as `inProgressReviewOfIds` reads them; oldest filed first. */
  reviewRowsOf(ticketId: string): readonly Readonly<Task>[] {
    return this.records.progress.tasks.filter((task) => task.reviewOf === ticketId).toSorted((a, b) => a.id - b.id);
  }

  /** Oldest filed first; free-standing rows only, since a ticket's own row is never a review bar; a bar naming a missing ticket is still returned. */
  reviewBarsOf(ticketId: string): readonly Readonly<Task>[] {
    return this.reviewBars.reviewBarRecordsOf(ticketId);
  }

  /** The row the ticket's frontmatter `task` names, which the ticket verbs move; `ownRowOf` is the first row naming the ticket, which a reader draws. */
  linkedRowOf(ticketId: string): Readonly<Task> | null {
    return this.records.linkedTaskRecordOf(this.records.requireTicket(ticketId)) ?? null;
  }

  /** The first row whose `ticket` is the id, which may differ from the row the ticket's frontmatter `task` points at. */
  ownRowOf(ticketId: string): Readonly<Task> | null {
    return this.records.progress.tasks.find((task) => task.ticket === ticketId) ?? null;
  }

  /** A ticket's own row or a review bar, even one naming a missing ticket; everything else is a free-standing task row. */
  taskIsTicketWork(task: Readonly<Task>): boolean {
    return task.ticket !== null || task.reviewOf !== undefined;
  }

  /** Read on the record handed in rather than looked up by id, so a hand-duplicated id cannot borrow another row's verdict. */
  taskIsSettled(task: Readonly<Task>): boolean {
    return SETTLED_TASK_STATUSES.includes(task.status);
  }

  ticketIsSettled(ticket: Readonly<Ticket>): boolean {
    return SETTLED_TICKET_STATUSES.includes(ticket.frontmatter.status);
  }

  /** Read on the record handed in, like `taskIsSettled`. */
  rowDisplayStateOf(task: Readonly<Task>): DisplayState {
    return displayStateFor(task.status, this.ticketStatusOfRow(task));
  }

  /** Read on the record handed in, like `rowDisplayStateOf`; a ticket without a row shows what a row in its own status would. */
  ticketDisplayStateOf(ticket: Readonly<Ticket>): DisplayState {
    const { id, status } = ticket.frontmatter;
    return displayStateFor(this.ownRowOf(id)?.status ?? status, status);
  }

  deliveredRowCountsAsReviewed(task: Readonly<Task>): boolean {
    // A delivered ticket passed `reviewed`, so its row counts without a stamp; this stays a query because ingestion would have to invent
    // the stamp and read the ticket files.
    return task.status === 'delivered' && (task.reviewed !== undefined || this.ticketStatusOfRow(task) === 'delivered');
  }

  private ticketStatusOfRow(task: Readonly<Task>): TicketStatus | null {
    if (task.ticket === null) return null;
    return this.records.ticketRecordById(task.ticket)?.frontmatter.status ?? null;
  }
}

function displayStateFor(status: TaskStatus, ticketStatus: TicketStatus | null): DisplayState {
  return status === 'in-review' && ticketStatus === 'in-review' ? 'reviewing' : status;
}
