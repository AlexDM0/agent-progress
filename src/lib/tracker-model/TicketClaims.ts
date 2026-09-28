/**
 * A builder's claim of one ticket or a bundle as one agent: every ticket started and keyed to the agent together, or the whole claim
 * refused, against the concurrency limit, the tickets' dependencies and holds and a reviewer already at work.
 */
import type { TicketClaim, TicketsClaimed } from './@types/BoardChanges.ts';
import type { Ticket }                      from './@types/Ticket.ts';
import type { BoardRecords }                from './BoardRecords.ts';
import { BoardRefusal }                     from './BoardRefusal.ts';
import type { DispatchQueries }             from './DispatchQueries.ts';
import type { GroupReleases }               from './GroupReleases.ts';
import type { ReviewBars }                  from './ReviewBars.ts';
import type { TicketMoves }                 from './TicketMoves.ts';
import { TicketMoveUtil }                   from './utils/TicketMoveUtil.ts';

const BUNDLE_AGENT_KEY_SEPARATOR = ',';

export class TicketClaims {
  constructor(
    private readonly records: BoardRecords,
    private readonly ticketMoves: TicketMoves,
    private readonly reviewBars: ReviewBars,
    private readonly dispatchQueries: DispatchQueries,
    private readonly groupReleases: GroupReleases,
  ) {}

  /**
   * A start plus the row's agent key, owner and note for every ticket named, as one agent, refused rather than warned: the claim
   * is all or nothing, so two claims racing for the last slot cannot both pass the count.
   */
  claimTickets(ticketIds: readonly string[], claim: TicketClaim, at: string): TicketsClaimed {
    const claimedTicketIds = [...new Set(ticketIds)].sort((a, b) => a.localeCompare(b));
    const claimedTickets   = claimedTicketIds.map((ticketId) => this.records.requireTicket(ticketId));
    const { afterTicketId } = claim;
    if (afterTicketId !== undefined) for (const ticket of claimedTickets) this.refuseAClaimAfterAnIneligiblePredecessor(ticket, afterTicketId);
    const settledForThisClaim = afterTicketId === undefined ? claimedTicketIds : [...claimedTicketIds, afterTicketId];
    for (const ticket of claimedTickets) this.refuseAnUnclaimableTicket(ticket, settledForThisClaim);
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
        if (claim.owner !== undefined) row.owner = claim.owner;
        if (claim.note !== undefined) row.note = claim.note;
      }
      return moveRecord;
    });
    return { logged, tickets: claimedTickets, concurrency: this.dispatchQueries.concurrency() };
  }

  /**
   * A pipelined successor starts while its predecessor is reviewed, so the predecessor must be in review, one of its unsettled
   * dependencies and in the same group's release bundle, which ships them together.
   */
  private refuseAClaimAfterAnIneligiblePredecessor(ticket: Readonly<Ticket>, afterTicketId: string): void {
    const { id: ticketId, group } = ticket.frontmatter;
    const predecessor             = this.records.requireTicket(afterTicketId);
    const predecessorStatus       = predecessor.frontmatter.status;
    if (predecessorStatus !== 'in-review') {
      throw new BoardRefusal({
        reason: 'claim-after-a-ticket-not-in-review',
        ticketId,
        afterTicketId,
        status: predecessorStatus,
      });
    }
    const releaseBundle = group === undefined ? [] : this.groupReleases.releaseBundleOf(group);
    if (!releaseBundle.includes(ticketId) || !releaseBundle.includes(afterTicketId)) {
      throw new BoardRefusal({ reason: 'claim-after-a-ticket-outside-the-bundle', ticketId, afterTicketId });
    }
    if (!this.dispatchQueries.unsettledDependenciesOf(ticketId).includes(afterTicketId)) {
      throw new BoardRefusal({ reason: 'claim-after-a-ticket-it-does-not-wait-on', ticketId, afterTicketId });
    }
  }

  /** A dependency on a ticket in the same claim, or on the predecessor it is claimed after, is settled: one agent works a bundle in dependency order. */
  private refuseAnUnclaimableTicket(ticket: Readonly<Ticket>, settledTicketIds: readonly string[]): void {
    const { id: ticketId, status } = ticket.frontmatter;
    if (!TicketMoveUtil.ticketMoveIsLegal(status, 'in-progress')) throw new BoardRefusal({ reason: 'unclaimable-status', ticketId, status });
    const unsettledTicketIds = this.dispatchQueries.unsettledDependenciesOf(ticketId).filter((dependencyId) => !settledTicketIds.includes(dependencyId));
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
