/**
 * What the Overseer reads off the Board to start its next job: the concurrency, the ready and held tickets, what a ticket still waits
 * on, which tickets have a builder or a reviewer at work, and the check command a release runs.
 */
import type { Concurrency, DispatchCapacity } from './@types/Concurrency.ts';
import type { Task }                          from './@types/Task.ts';
import type { ReadyTicket, Ticket }           from './@types/Ticket.ts';
import type { OverseerState }                 from './@types/TrackerProgress.ts';
import type { BoardRecords }                  from './BoardRecords.ts';
import type { GroupReleases }                 from './GroupReleases.ts';
import { DEFAULT_OVERSEER_STATE }             from './constants/OverseerStates.ts';
import { SETTLED_TICKET_STATUSES }            from './constants/Statuses.ts';
import { ConcurrencyUtil }                    from './utils/ConcurrencyUtil.ts';
import { TicketDefaultsUtil }                 from './utils/TicketDefaultsUtil.ts';
import { TicketDependencyUtil }               from './utils/TicketDependencyUtil.ts';

export class DispatchQueries {
  constructor(
    private readonly records: BoardRecords,
    private readonly groupReleases: GroupReleases,
  ) {}

  concurrency(): Concurrency {
    return ConcurrencyUtil.concurrencyOf(this.records.progress.tasks, this.records.progress.concurrencyLimit);
  }

  overseerState(): OverseerState {
    return this.records.progress.overseerState ?? DEFAULT_OVERSEER_STATE;
  }

  /** In the order to take them: by priority, then by readiness, then by id. */
  readyTickets(): readonly Readonly<Ticket>[] {
    const readyTicketIds = TicketDependencyUtil.readyTicketIdsOf(this.records.ticketRecords.map((ticket) => ticket.frontmatter), this.readinessPositionByTicketId());
    return this.withoutGroupRunTickets(readyTicketIds.flatMap((ticketId) => this.records.ticketRecordById(ticketId) ?? []));
  }

  /** The log position of each ticket's latest `ticket-readied` or `ticket-reopened` record; a clearing forgets every earlier one. */
  readinessPositionByTicketId(): Map<string, number> {
    const positionByTicketId = new Map<string, number>();
    [...this.records.storedLogRecords, ...this.records.loggedRecords].forEach((record, position) => {
      if (record.kind === 'tracker-cleared') positionByTicketId.clear();
      if (record.kind === 'ticket-readied' || record.kind === 'ticket-reopened') positionByTicketId.set(record.ticketId, position);
    });
    return positionByTicketId;
  }

  /** Read from the ready tickets, as `readyTicketIds` is, so the two lists cannot disagree on a member or the order; defaults resolved here. */
  readyTicketEntries(): ReadyTicket[] {
    return this.readyTickets().map(({ frontmatter }) => ({
      id:       frontmatter.id,
      priority: TicketDefaultsUtil.ticketPriorityOf(frontmatter),
      model:    TicketDefaultsUtil.agentModelOf(frontmatter),
      effort:   TicketDefaultsUtil.agentEffortOf(frontmatter),
      ...(frontmatter.group === undefined ? {} : { group: frontmatter.group }),
      ...(frontmatter.hold === undefined ? {} : { held: true as const }),
    }));
  }

  /** Every held ticket the Overseer could still start a step of, in progress or in review as much as ready. */
  heldTicketIds(): string[] {
    return this.records.ticketRecords
      .filter((ticket) => ticket.frontmatter.hold !== undefined && !SETTLED_TICKET_STATUSES.includes(ticket.frontmatter.status))
      .map((ticket) => ticket.frontmatter.id);
  }

  /**
   * What the Overseer needs to start the next job: the limit, the agents in flight against it, what is left, and the tickets that could take it —
   * in the order to take them — and where the user left the Overseer.
   */
  dispatchCapacity(): DispatchCapacity {
    return {
      ...this.concurrency(),
      readyTicketIds: this.readyTickets().map((ticket) => ticket.frontmatter.id),
      overseerState:  this.overseerState(),
      heldTicketIds:  this.heldTicketIds(),
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
    return this.withoutGroupRunTickets(this.records.ticketRecords.filter((ticket) => (
      ticket.frontmatter.status === 'in-review' && !ticketIdsUnderReview.includes(ticket.frontmatter.id)
    )));
  }

  /** The tickets with a build to resume, in file order. */
  pausedBuildTickets(): readonly Readonly<Ticket>[] {
    return this.withoutGroupRunTickets(this.records.ticketRecords.filter((ticket) => this.pausedBuildRowOf(ticket.frontmatter.id) !== null));
  }

  /** While a group awaits its release, its tickets are the group run's: a whole-board run must not build, review or resume one off the main line. */
  private withoutGroupRunTickets(tickets: readonly Readonly<Ticket>[]): readonly Readonly<Ticket>[] {
    const groupsAwaitingTheirRelease = this.groupReleases.groupsAwaitingTheirRelease();
    return tickets.filter(({ frontmatter }) => frontmatter.group === undefined || !groupsAwaitingTheirRelease.has(frontmatter.group));
  }
}
