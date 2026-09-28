/**
 * A ticket's lifecycle on the Board: its filing, its moves between statuses with the row following along, a further review pass, and
 * its release, each stamping the ticket and logging the move.
 */
import type {
  TicketChanged,
  TicketMoved,
  TicketMoveRequest,
  TicketRelease,
  TicketsReleased
}                                         from './@types/BoardChanges.ts';
import type { LogRecord }                               from './@types/LogRecord.ts';
import type { Ticket, TicketFrontmatter, TicketStatus } from './@types/Ticket.ts';
import type { BoardRecords }                            from './BoardRecords.ts';
import { BoardRefusal }                                 from './BoardRefusal.ts';
import type { GroupReleases }                           from './GroupReleases.ts';
import type { ReviewBars, ReviewBarsClosed }            from './ReviewBars.ts';
import type { TicketDependencies }                      from './TicketDependencies.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                    from './constants/ReviewRounds.ts';
import { TicketMoveUtil }                               from './utils/TicketMoveUtil.ts';
import { TicketStampUtil }                              from './utils/TicketStampUtil.ts';

type TicketMoveFields = Pick<TicketMoveRequest, 'branch' | 'commit' | 'reason'>;

export class TicketMoves {
  constructor(
    private readonly records: BoardRecords,
    private readonly reviewBars: ReviewBars,
    private readonly dependencies: TicketDependencies,
    private readonly groupReleases: GroupReleases,
  ) {}

  /** Judged against the tickets already on the board, before the new one joins, so a ticket naming its own id names no ticket. */
  fileTicket(ticket: Ticket, at: string): TicketChanged {
    const { frontmatter } = ticket;
    this.dependencies.refuseAnUnworkableDependencyList(frontmatter.id, frontmatter.dependsOn ?? []);
    this.records.ticketRecords.push(ticket);
    this.records.ensureTaskForTicketOnTheChart(ticket, at);
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-filed', ticketId: frontmatter.id, fields: { title: frontmatter.title } }, at)], ticket };
  }

  /**
   * `checksLegality` false is the deliberate override of the legality table. The tokens are judged after the move, which files a
   * low ticket's row when it starts; a refused invocation writes nothing, so the move before the refusal is never seen.
   */
  moveTicket(ticketId: string, targetStatus: TicketStatus, request: TicketMoveRequest, at: string): TicketMoved {
    const ticket     = this.records.requireTicket(ticketId);
    const { status } = ticket.frontmatter;
    if (status === targetStatus) throw new BoardRefusal({ reason: 'ticket-already-in-status', ticketId, status });
    if (request.checksLegality && !TicketMoveUtil.ticketMoveIsLegal(status, targetStatus)) {
      throw new BoardRefusal({
        reason: 'illegal-ticket-move',
        ticketId,
        status,
        targetStatus,
      });
    }
    if (targetStatus === 'abandoned' && (request.reason === undefined || request.reason.trim() === '')) {
      throw new BoardRefusal({ reason: 'abandon-without-reason', ticketId });
    }
    // A Board invariant rather than a move's legality, so `ticket status` is held to it too.
    this.groupReleases.refuseReopeningBesideAnOpenReleaseTicket(ticket, targetStatus);

    const moveRecord = this.applyTicketMove(ticket, targetStatus, request, at);
    if (request.tokens !== undefined) {
      if (ticket.frontmatter.task === null) throw new BoardRefusal({ reason: 'tokens-without-a-row', ticketId });
      const row = this.records.taskRecordById(ticket.frontmatter.task);
      if (row !== undefined) row.tokens = request.tokens;
    }
    // A reviewer is at work only while the ticket is in review, so every move out of it ends the bar, as a release does.
    const closed: ReviewBarsClosed = targetStatus === 'in-review' ? { bars: [], logged: [] } : this.reviewBars.closeInProgressReviewBars([ticketId], at);
    return { logged: [moveRecord, ...closed.logged], ticket, closedReviewBars: closed.bars };
  }

  /** The one move that leaves a ticket in its status: a further review pass is still review, so only `updated` moves and the row counts the round. */
  rereviewTicket(ticketId: string, at: string): TicketChanged {
    const ticket          = this.records.requireTicket(ticketId);
    const { frontmatter } = ticket;
    if (frontmatter.status !== 'in-review') throw new BoardRefusal({ reason: 'rereview-outside-review', ticketId, status: frontmatter.status });

    frontmatter.updated = at;
    const task          = this.records.ensureTaskForTicket(ticket, at);
    this.records.transitionTaskInPlace(task, 're-review', at);
    this.records.markChanged(ticket);
    const round         = task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND;
    return { logged: [this.records.logger.log({ kind: 'ticket-rereviewed', ticketId, fields: { round } }, at)], ticket };
  }

  /**
   * Each ticket is reviewed and then delivered, in the order given, and every in-progress review bar of them is closed after the moves.
   * A bundle ticket already reviewed skips the first move, so it is approved once.
   */
  releaseTickets(ticketIds: readonly string[], release: TicketRelease, at: string): TicketsReleased {
    const releasedTicketIds = [...new Set(ticketIds)];
    const releasedTickets   = releasedTicketIds.map((ticketId) => this.records.requireTicket(ticketId));
    const unreleasable      = releasedTickets.find((ticket) => !this.ticketIsReleasable(ticket, releasedTicketIds));
    if (unreleasable !== undefined) {
      throw new Error(`Ticket #${unreleasable.frontmatter.id} is ${unreleasable.frontmatter.status}; a caller refuses such a release before asking for it.`);
    }

    const logged: LogRecord[] = [];
    for (const ticket of releasedTickets) {
      if (ticket.frontmatter.status !== 'reviewed') logged.push(this.applyTicketMove(ticket, 'reviewed', {}, at));
      logged.push(this.applyTicketMove(ticket, 'delivered', release, at));
    }
    // The reviewer releases as the last step of its pass, so its bar is closed here rather than left in progress until the verdict is read.
    const closed = this.reviewBars.closeInProgressReviewBars(releasedTickets.map((ticket) => ticket.frontmatter.id), at);
    return { logged: [...logged, ...closed.logged], tickets: releasedTickets, closedReviewBars: closed.bars };
  }

  /**
   * A release reviews the ticket on its way to delivering it, so it takes the tickets a move to `reviewed` is legal from, and besides
   * them a `reviewed` ticket of a release bundle whose release ticket, itself releasable that way, is released with it.
   */
  ticketIsReleasable(ticket: Readonly<Ticket>, releasedTicketIds: readonly string[]): boolean {
    const { id: ticketId, status, group } = ticket.frontmatter;
    if (TicketMoveUtil.ticketMoveIsLegal(status, 'reviewed')) return true;
    if (status !== 'reviewed' || group === undefined) return false;
    const releaseBundle = this.groupReleases.releaseBundleOf(group);
    return releaseBundle.includes(ticketId) && releasedTicketIds.some((releasedTicketId) => {
      const releasedTicket = this.records.ticketRecordById(releasedTicketId);
      return releasedTicket !== undefined
        && releasedTicket.frontmatter.releasesGroup === true
        && releaseBundle.includes(releasedTicketId)
        && TicketMoveUtil.ticketMoveIsLegal(releasedTicket.frontmatter.status, 'reviewed');
    });
  }

  /** The move itself, unchecked: the status, its stamps and the fields given, and the row taking the same status. */
  applyTicketMove(ticket: Ticket, targetStatus: TicketStatus, fields: TicketMoveFields, at: string): LogRecord {
    const { frontmatter } = ticket;
    frontmatter.status      = targetStatus;
    frontmatter.updated     = at;
    const stamps            = TicketStampUtil.stampsAfterMoveOf(frontmatter, targetStatus, at);
    frontmatter.started     = stamps.started;
    frontmatter.finished    = stamps.finished;
    frontmatter.delivered   = stamps.delivered;
    frontmatter.abandonedAt = stamps.abandonedAt;
    if (stamps.clearsReason) delete frontmatter.reason;
    if (fields.branch !== undefined) frontmatter.branch = fields.branch;
    if (fields.commit !== undefined) frontmatter.commit = fields.commit;
    if (fields.reason !== undefined) frontmatter.reason = fields.reason;

    const task = this.records.ensureTaskForTicketOnTheChart(ticket, at);
    if (task !== null) this.records.transitionTaskInPlace(task, targetStatus, at);
    this.records.markChanged(ticket);
    return this.logTicketMove(frontmatter, targetStatus, at);
  }

  /** `pending` is logged as a reopen: a ticket's first `pending` is its filing, which `fileTicket` logs. */
  private logTicketMove(frontmatter: Readonly<TicketFrontmatter>, targetStatus: TicketStatus, at: string): LogRecord {
    const ticketId = frontmatter.id;
    const { logger } = this.records;
    switch (targetStatus) {
      case 'pending':
        return logger.log({ kind: 'ticket-reopened', ticketId, fields: {} }, at);
      case 'in-progress':
        return logger.log({ kind: 'ticket-started', ticketId, fields: {} }, at);
      case 'in-review':
        return logger.log({ kind: 'ticket-finished', ticketId, fields: {} }, at);
      case 'reviewed':
        return logger.log({ kind: 'ticket-approved', ticketId, fields: {} }, at);
      case 'delivered':
        return logger.log({ kind: 'ticket-delivered', ticketId, fields: {} }, at);
      case 'abandoned':
        return logger.log({ kind: 'ticket-abandoned', ticketId, fields: { reason: frontmatter.reason ?? '' } }, at);
    }
  }
}
