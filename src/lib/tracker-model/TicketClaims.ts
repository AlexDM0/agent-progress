/**
 * A builder's claim of one ticket or a bundle as one agent: every ticket started and keyed to the agent together, or the whole claim
 * refused, against the concurrency limit, the tickets' dependencies and holds and a reviewer already at work.
 */
import type { AgentAssignment, TicketsClaimed } from './@types/BoardChanges.ts';
import type { Ticket }                          from './@types/Ticket.ts';
import type { BoardRecords }                    from './BoardRecords.ts';
import { BoardRefusal }                         from './BoardRefusal.ts';
import type { DispatchQueries }                 from './DispatchQueries.ts';
import type { ReviewBars }                      from './ReviewBars.ts';
import type { TicketMoves }                     from './TicketMoves.ts';
import { TicketMoveUtil }                       from './utils/TicketMoveUtil.ts';

const BUNDLE_AGENT_KEY_SEPARATOR = ',';

export class TicketClaims {
  constructor(
    private readonly records: BoardRecords,
    private readonly ticketMoves: TicketMoves,
    private readonly reviewBars: ReviewBars,
    private readonly dispatchQueries: DispatchQueries,
  ) {}

  /**
   * A start plus the row's agent key, owner and note for every ticket named, as one agent, refused rather than warned: the claim
   * is all or nothing, so two claims racing for the last slot cannot both pass the count.
   */
  claimTickets(ticketIds: readonly string[], assignment: AgentAssignment, at: string): TicketsClaimed {
    const claimedTicketIds = [...new Set(ticketIds)].sort((a, b) => a.localeCompare(b));
    const claimedTickets   = claimedTicketIds.map((ticketId) => this.records.requireTicket(ticketId));
    for (const ticket of claimedTickets) this.refuseAnUnclaimableTicket(ticket, claimedTicketIds);
    for (const ticketId of claimedTicketIds) this.refuseATicketUnderReview(ticketId);
    const { agentsInFlight, limit } = this.dispatchQueries.concurrency();
    if (agentsInFlight >= limit) {
      throw new BoardRefusal({
        reason:             'concurrency-limit-reached',
        ticketIds:          claimedTicketIds,
        agentsInFlight,
        inProgressRowCount: this.records.progress.tasks.filter((task) => task.status === 'in-progress').length,
        limit,
      });
    }

    // Every id of the claim, not the lowest alone: a bundle ticket reopened and claimed on its own must not share a key with the rest
    // still in progress.
    const agentKey = claimedTicketIds.join(BUNDLE_AGENT_KEY_SEPARATOR);
    const logged   = claimedTickets.map((ticket) => {
      const moveRecord = this.ticketMoves.applyTicketMove(ticket, 'in-progress', {}, at);
      const row        = this.records.linkedTaskRecordOf(ticket);
      if (row !== undefined) {
        row.agent = agentKey;
        if (assignment.owner !== undefined) row.owner = assignment.owner;
        if (assignment.note !== undefined) row.note = assignment.note;
      }
      return moveRecord;
    });
    return { logged, tickets: claimedTickets, concurrency: this.dispatchQueries.concurrency() };
  }

  /** A dependency on another ticket in the same claim is settled: one agent works a bundle in dependency order. */
  private refuseAnUnclaimableTicket(ticket: Readonly<Ticket>, claimedTicketIds: readonly string[]): void {
    const { id: ticketId, status } = ticket.frontmatter;
    if (!TicketMoveUtil.ticketMoveIsLegal(status, 'in-progress')) throw new BoardRefusal({ reason: 'unclaimable-status', ticketId, status });
    const unsettledTicketIds = this.dispatchQueries.unsettledDependenciesOf(ticketId).filter((dependencyId) => !claimedTicketIds.includes(dependencyId));
    if (unsettledTicketIds.length > 0) throw new BoardRefusal({ reason: 'claim-waits-on-dependencies', ticketId, unsettledTicketIds });
    if (ticket.frontmatter.hold !== undefined) throw new BoardRefusal({ reason: 'claim-of-a-held-ticket', ticketId });
    const holdingBackTicketIds = this.dispatchQueries.ticketIdsHoldingBack(ticketId);
    if (holdingBackTicketIds.length > 0) throw new BoardRefusal({ reason: 'claim-of-held-back-low-ticket', ticketId, holdingBackTicketIds });
  }

  // An in-progress review bar is a reviewer at work, so a builder claiming the ticket, a second dispatcher run's among them, would rebuild it in review.
  private refuseATicketUnderReview(ticketId: string): void {
    const [inProgressBar] = this.reviewBars.inProgressReviewBarsOf([ticketId]);
    if (inProgressBar !== undefined) throw new BoardRefusal({ reason: 'claim-under-review', ticketId, reviewBarTaskId: inProgressBar.id });
  }
}
