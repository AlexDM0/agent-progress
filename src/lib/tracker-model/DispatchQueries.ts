/**
 * What a dispatcher reads off the Board to start its next agent: the concurrency, the ready and held tickets, what a ticket still waits
 * on, and which tickets have a builder or a reviewer at work.
 */
import type { Concurrency, DispatchCapacity } from './@types/Concurrency.ts';
import type { Task }                          from './@types/Task.ts';
import type { ReadyTicket, Ticket }           from './@types/Ticket.ts';
import type { DispatcherState }               from './@types/TrackerProgress.ts';
import type { BoardRecords }                  from './BoardRecords.ts';
import { DEFAULT_DISPATCHER_STATE }           from './constants/DispatcherStates.ts';
import { SETTLED_TICKET_STATUSES }            from './constants/Statuses.ts';
import { ConcurrencyUtil }                    from './utils/ConcurrencyUtil.ts';
import { TicketDefaultsUtil }                 from './utils/TicketDefaultsUtil.ts';
import { TicketDependencyUtil }               from './utils/TicketDependencyUtil.ts';

export class DispatchQueries {
  constructor(private readonly records: BoardRecords) {}

  concurrency(): Concurrency {
    return ConcurrencyUtil.concurrencyOf(this.records.progress.tasks, this.records.progress.concurrencyLimit);
  }

  dispatcherState(): DispatcherState {
    return this.records.progress.dispatcherState ?? DEFAULT_DISPATCHER_STATE;
  }

  dispatcherRunId(): string | undefined {
    return this.records.progress.dispatcherRunId;
  }

  /** In the order to take them: high first, then by id, with low tickets held back while normal or high work is still owed. */
  readyTickets(): readonly Readonly<Ticket>[] {
    const readyTicketIds = TicketDependencyUtil.readyTicketIdsOf(this.records.ticketRecords.map((ticket) => ticket.frontmatter));
    return readyTicketIds.flatMap((ticketId) => this.records.ticketRecordById(ticketId) ?? []);
  }

  /** Read from the ready tickets, as `readyTicketIds` is, so the two lists cannot disagree on a member or the order; defaults resolved here. */
  readyTicketEntries(): ReadyTicket[] {
    return this.readyTickets().map(({ frontmatter }) => ({
      id:       frontmatter.id,
      priority: TicketDefaultsUtil.ticketPriorityOf(frontmatter),
      model:    TicketDefaultsUtil.agentModelOf(frontmatter),
      effort:   TicketDefaultsUtil.agentEffortOf(frontmatter),
      ...(frontmatter.hold === undefined ? {} : { held: true as const }),
    }));
  }

  /** Every held ticket a dispatcher could still start a step of, in progress or in review as much as ready. */
  heldTicketIds(): string[] {
    return this.records.ticketRecords
      .filter((ticket) => ticket.frontmatter.hold !== undefined && !SETTLED_TICKET_STATUSES.includes(ticket.frontmatter.status))
      .map((ticket) => ticket.frontmatter.id);
  }

  /**
   * What a dispatcher needs to start the next agent: the limit, the agents in flight against it, what is left, and the tickets that could take it —
   * in the order to take them, high first, with low tickets held back while normal or high work is still owed — and where the user left the dispatcher.
   */
  dispatchCapacity(): DispatchCapacity {
    return {
      ...this.concurrency(),
      readyTicketIds:  this.readyTickets().map((ticket) => ticket.frontmatter.id),
      dispatcherState: this.dispatcherState(),
      heldTicketIds:   this.heldTicketIds(),
    };
  }

  /** A dependency missing from the board counts as unsettled: a ticket nobody can see is not finished work. */
  unsettledDependenciesOf(ticketId: string): string[] {
    const ticket = this.records.requireTicket(ticketId);
    return TicketDependencyUtil.unsettledDependenciesOf(ticket.frontmatter.dependsOn ?? [], this.records.ticketStatusById());
  }

  /** Judges the record handed in, so a ticket file a hand edit gave another's id answers for itself. */
  waitingOnOf(ticket: Readonly<Ticket>): string[] {
    return TicketDependencyUtil.waitingOnOf(ticket.frontmatter, this.records.ticketStatusById());
  }

  /** The normal and high tickets a low ticket waits behind; empty for a ticket that is not low, and once none is owed. */
  ticketIdsHoldingBack(ticketId: string): string[] {
    const ticket = this.records.requireTicket(ticketId);
    if (TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter) !== 'low') return [];
    return TicketDependencyUtil.ticketsHoldingBackLowPriorityWork(this.records.ticketRecords.map((candidate) => candidate.frontmatter));
  }

  /** Only an in-progress ticket has a build to resume; a ticket that moved on took its row along. */
  pausedBuildRowOf(ticketId: string): Readonly<Task> | null {
    const ticket = this.records.requireTicket(ticketId);
    if (ticket.frontmatter.status !== 'in-progress') return null;
    const row = this.records.linkedTaskRecordOf(ticket);
    return row?.status === 'paused' ? row : null;
  }

  /** In row order, once each. */
  inProgressTicketIds(): string[] {
    return [...new Set(this.records.progress.tasks.flatMap((task) => (task.status === 'in-progress' && task.ticket !== null ? [task.ticket] : [])))];
  }

  /** Matches `reviewOf` on any row, as a claim and the moves out of review do, so a ticket-owned row storing it counts; in row order, once each. */
  inProgressReviewOfIds(): string[] {
    return [...new Set(this.records.progress.tasks.flatMap((task) => (task.status === 'in-progress' && task.reviewOf !== undefined ? [task.reviewOf] : [])))];
  }

  /** The in-review tickets no reviewer is at work on, held ones included: a caller reads the holds from `heldTicketIds`. */
  reviewWaitingTickets(): readonly Readonly<Ticket>[] {
    const ticketIdsUnderReview = this.inProgressReviewOfIds();
    return this.records.ticketRecords.filter((ticket) => ticket.frontmatter.status === 'in-review' && !ticketIdsUnderReview.includes(ticket.frontmatter.id));
  }
}
