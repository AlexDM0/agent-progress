/** An agent's stop on the Board: its usage logged and its tokens credited to the row, ticket or review bar its brief named, one verdict per credit. */
import type { AgentStopRecorded, TokenCredit, TokenCreditOutcome } from './@types/BoardChanges.ts';
import type { AgentUsage }                                         from './@types/LogRecord.ts';
import type { Task }                                               from './@types/Task.ts';
import type { BoardRecords }                                       from './BoardRecords.ts';
import type { ReviewBar, ReviewBars }                              from './ReviewBars.ts';

export class TokenCredits {
  constructor(
    private readonly records: BoardRecords,
    private readonly reviewBars: ReviewBars,
  ) {}

  /** A credit that cannot land is a verdict beside the others, never a refusal, as the agent has already finished; the usage is logged after them. */
  recordAgentStop(usage: AgentUsage, credits: readonly TokenCredit[], at: string): AgentStopRecorded {
    const outcomes = credits.map((credit) => this.creditTokens(credit));
    return { logged: [this.records.logger.log({ kind: 'agent-stopped', fields: usage }, at)], outcomes };
  }

  /** A ticket's share lands on the row the ticket has now, which may have been filed after the brief that named the ticket. */
  private creditTokens(credit: TokenCredit): TokenCreditOutcome {
    if (credit.target === 'row') {
      const task = this.records.taskRecordById(credit.taskId);
      if (task === undefined) return { verdict: 'unknown-row', taskId: credit.taskId };
      return creditTokensTo(task, credit.tokens);
    }

    // The bar's status is not consulted: release has already delivered it by the time its reviewer stops.
    if (credit.target === 'review') {
      // On a hand-duplicated id the first bar in the file wins.
      const newestBar = this.reviewBars.reviewBarRecordsOf(credit.ticketId)
        .reduce<ReviewBar | undefined>((newest, bar) => (newest === undefined || bar.id > newest.id ? bar : newest), undefined);
      if (newestBar === undefined) return { verdict: 'ticket-without-review-bar', ticketId: credit.ticketId };
      // Credited by id like a row share, so a hand-repeated id lands on the first row holding it.
      return creditTokensTo(this.records.taskRecordById(newestBar.id) ?? newestBar, credit.tokens);
    }

    const ticket = this.records.ticketRecordById(credit.ticketId);
    if (ticket === undefined) return { verdict: 'unknown-ticket', ticketId: credit.ticketId };
    const taskId = ticket.frontmatter.task;
    if (taskId === null) return { verdict: 'ticket-without-row', ticketId: credit.ticketId };
    const task = this.records.taskRecordById(taskId);
    if (task === undefined) return { verdict: 'ticket-row-missing', ticketId: credit.ticketId, taskId };
    return creditTokensTo(task, credit.tokens);
  }
}

/** Accumulates rather than sets, so an agent's tokens reach a row other agents have already worked on; an unset count counts as 0. */
function creditTokensTo(task: Task, tokens: number): TokenCreditOutcome {
  task.tokens = (task.tokens ?? 0) + tokens;
  return { verdict: 'credited', taskId: task.id };
}
