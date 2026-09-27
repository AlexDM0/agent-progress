/** How a ticket move prints the review bars it opened and closed, as text and as the ticket's JSON document. */
import { TicketJsonUtil }        from '../../../src/adapters/utils/TicketJsonUtil.ts';
import type { ReviewBarStarted } from '../../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { LogRecord }        from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import type { Task }             from '../../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket }           from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { OutputUtil }            from '../../utils/OutputUtil.ts';

/** A closed bar is printed by its id alone, not as the sentence the log holds for it. */
function recordClosesNoBar(record: LogRecord): boolean {
  return record.kind !== 'review-bar-closed';
}

function idsOf(bars: readonly Readonly<Task>[]): number[] {
  return bars.map((bar) => bar.id);
}

function closedReviewBarsText(closedBars: readonly Readonly<Task>[]): string {
  return closedBars.map((bar) => `\nClosed the review row #${bar.id}, delivered`).join('');
}

function reviewBarText(started: ReviewBarStarted | null): string {
  if (started === null) return '';
  return `${closedReviewBarsText(started.closedBars)}\n${OutputUtil.loggedSentencesOf(started.logged.filter(recordClosesNoBar))}`;
}

function ticketWithReviewBarAsJson(ticket: Ticket, started: ReviewBarStarted | null, closedBars: readonly Readonly<Task>[] = []): Record<string, unknown> {
  if (started !== null) return { ...TicketJsonUtil.ticketAsJson(ticket), reviewRow: started.bar, closedReviewRows: idsOf(started.closedBars) };
  if (closedBars.length > 0) return { ...TicketJsonUtil.ticketAsJson(ticket), closedReviewRows: idsOf(closedBars) };
  return TicketJsonUtil.ticketAsJson(ticket);
}

export const ReviewBarOutputUtil = {
  recordClosesNoBar,
  closedReviewBarsText,
  reviewBarText,
  ticketWithReviewBarAsJson,
} as const;
