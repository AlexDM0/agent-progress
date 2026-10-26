/** The Board's review bars: the free-standing rows a reviewer works in, started one per pass and closed by every move that ends the review. */
import type {
  ReviewBarRequest,
  ReviewBarStarted,
  ReviewRecorded,
  ReviewRecording
} from './@types/BoardChanges.ts';
import type { LogRecord }    from './@types/LogRecord.ts';
import type { Task }         from './@types/Task.ts';
import type { Ticket }       from './@types/Ticket.ts';
import type { BoardRecords } from './BoardRecords.ts';
import { BoardRefusal }      from './BoardRefusal.ts';
import { TicketChartUtil }   from './utils/TicketChartUtil.ts';

export type ReviewBar = Task & { reviewOf: string };

export interface ReviewBarsClosed {
  bars:   ReviewBar[];
  logged: LogRecord[];
}

export class ReviewBars {
  constructor(private readonly records: BoardRecords) {}

  /**
   * Closes the ticket's in-progress review bars and starts the next one in the same change, so the ticket's slot is never free between
   * two agents. The round is the caller's to count from the ticket's body, so the Board reads no markdown; it names the bar and is stored on it.
   */
  startReviewBar(ticketId: string, request: ReviewBarRequest, at: string): ReviewBarStarted {
    const ticket = this.records.requireTicket(ticketId);
    const closed = this.closeInProgressReviewBars([ticketId], at);
    const bar    = this.records.fileTask({
      name:           TicketChartUtil.reviewBarNameOf(request.round, ticket.frontmatter),
      filedAt:        at,
      reviewOf:       ticketId,
      reviewBarRound: request.round,
      ...(request.owner === undefined ? {} : { owner: request.owner }),
      ...(request.note === undefined ? {} : { note: request.note }),
    });
    this.records.transitionTaskInPlace(bar, 'in-progress', at);
    const bundleAgentKey = this.agentKeyOfABundleStillInProgress(ticket);
    if (bundleAgentKey !== null) bar.agent = bundleAgentKey;
    const started = this.records.logger.log({
      kind:   'review-bar-started',
      taskId: bar.id,
      ticketId,
      fields: { name: bar.name },
    }, at);
    return { logged: [...closed.logged, started], bar, closedBars: closed.bars };
  }

  /** Finishes and delivers every in-progress review bar of the tickets, one record each, for every move that ends their review. */
  closeInProgressReviewBars(ticketIds: readonly string[], at: string): ReviewBarsClosed {
    const bars                = this.inProgressReviewBarsOf(ticketIds);
    const logged: LogRecord[] = [];
    for (const bar of bars) {
      this.records.transitionTaskInPlace(bar, 'in-review', at);
      this.records.transitionTaskInPlace(bar, 'delivered', at);
      logged.push(this.records.logger.log({
        kind:     'review-bar-closed',
        taskId:   bar.id,
        ticketId: bar.reviewOf,
        fields:   { name: bar.name },
      }, at));
    }
    return { bars, logged };
  }

  /**
   * Recorded on the ticket's newest in-progress review bar, the pass now running, whose stored round it takes. A bundle's review runs on
   * one bar, so `bundleBarTaskId` names it for each of the bundle's tickets.
   */
  recordReview(ticketId: string, recording: ReviewRecording, at: string, bundleBarTaskId: number | null = null): ReviewRecorded {
    const ticket = this.records.requireTicket(ticketId);
    const bar    = bundleBarTaskId === null ? this.inProgressReviewBarsOf([ticketId]).at(-1) : this.bundleReviewBarOf(ticket, bundleBarTaskId);
    if (bar === undefined) throw new BoardRefusal({ reason: 'review-record-without-a-review-bar', ticketId });
    const round = bar.reviewBarRound;
    if (round === undefined) throw new BoardRefusal({ reason: 'review-bar-without-a-round', ticketId, taskId: bar.id });
    const recorded = this.records.logger.log({
      kind:   'review-recorded',
      taskId: bar.id,
      ticketId,
      fields: { round, ...recording },
    }, at);
    return { logged: [recorded], taskId: bar.id, round };
  }

  /** Matches `reviewOf` on any row, unlike `reviewBarRecordsOf`, so a ticket-owned row storing it is closed and blocks a claim too; in file order. */
  inProgressReviewBarsOf(ticketIds: readonly string[]): ReviewBar[] {
    return this.records.progress.tasks.filter((task): task is ReviewBar => task.status === 'in-progress' && task.reviewOf !== undefined && ticketIds.includes(task.reviewOf));
  }

  /** Oldest filed first; free-standing rows only, since a ticket's own row is never a review bar; a bar naming a missing ticket is still returned. */
  reviewBarRecordsOf(ticketId: string): ReviewBar[] {
    return this.records.progress.tasks
      .filter((task): task is ReviewBar => task.ticket === null && task.reviewOf === ticketId)
      .toSorted((a, b) => a.id - b.id);
  }

  /** The bar must be an in-progress review bar of the ticket itself or of a ticket claimed with it, their own rows sharing one agent key. */
  private bundleReviewBarOf(ticket: Readonly<Ticket>, barTaskId: number): ReviewBar {
    const ticketId = ticket.frontmatter.id;
    const bar      = this.records.taskRecordById(barTaskId);
    if (bar?.status !== 'in-progress' || bar.reviewOf === undefined) {
      throw new BoardRefusal({ reason: 'review-record-on-a-row-that-is-not-a-review-bar', ticketId, taskId: barTaskId });
    }
    const reviewBar: ReviewBar = { ...bar, reviewOf: bar.reviewOf };
    if (reviewBar.reviewOf === ticketId) return reviewBar;
    const barTicket        = this.records.ticketRecordById(reviewBar.reviewOf);
    const ticketAgentKey   = this.records.linkedTaskRecordOf(ticket)?.agent;
    const barTicketAgentKey = barTicket === undefined ? undefined : this.records.linkedTaskRecordOf(barTicket)?.agent;
    if (ticketAgentKey === undefined || ticketAgentKey !== barTicketAgentKey) {
      throw new BoardRefusal({
        reason: 'review-record-on-a-bar-outside-the-bundle', ticketId, taskId: barTaskId, reviewOf: reviewBar.reviewOf
      });
    }
    return reviewBar;
  }

  /** A bundle is one agent, so its reviewer takes no second slot while the builder still holds the claim's slot for the bundle's other tickets. */
  private agentKeyOfABundleStillInProgress(ticket: Readonly<Ticket>): string | null {
    const claimAgentKey = this.records.linkedTaskRecordOf(ticket)?.agent;
    if (claimAgentKey === undefined) return null;
    return this.records.progress.tasks.some((row) => row.status === 'in-progress' && row.agent === claimAgentKey) ? claimAgentKey : null;
  }
}
