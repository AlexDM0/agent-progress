/** The Board's review bars: the free-standing rows a reviewer works in, started one per pass and closed by every move that ends the review. */
import type { ReviewBarRequest, ReviewBarStarted } from './@types/BoardChanges.ts';
import type { LogRecord }                          from './@types/LogRecord.ts';
import type { Task }                               from './@types/Task.ts';
import type { Ticket }                             from './@types/Ticket.ts';
import type { BoardRecords }                       from './BoardRecords.ts';
import { TicketChartUtil }                         from './utils/TicketChartUtil.ts';

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

  /** A bundle is one agent, so its reviewer takes no second slot while the builder still holds the claim's slot for the bundle's other tickets. */
  private agentKeyOfABundleStillInProgress(ticket: Readonly<Ticket>): string | null {
    const claimAgentKey = this.records.linkedTaskRecordOf(ticket)?.agent;
    if (claimAgentKey === undefined) return null;
    return this.records.progress.tasks.some((row) => row.status === 'in-progress' && row.agent === claimAgentKey) ? claimAgentKey : null;
  }
}
