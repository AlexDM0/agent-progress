/** Where a ticket stands on the chart: whether it has a row to be given at all, the names its rows are stored under, and the row it is seeded as. */
import type { TicketFrontmatter } from '../@types/Ticket.ts';
import type { TaskFiling }        from './TaskRecordUtil.ts';
import { TicketDefaultsUtil }     from './TicketDefaultsUtil.ts';

/**
 * A draft at any priority lives off the chart: `ticket ready` files its row. A low ticket never started waits off it while pending, and a
 * ticket abandoned before it was ever started, a draft above all, stays off at any priority. Callers ask only about a rowless ticket, so a
 * row it was given is kept.
 */
function ticketStaysOffTheChart(frontmatter: Pick<TicketFrontmatter, 'priority' | 'started' | 'status'>): boolean {
  if (frontmatter.status === 'draft') return true;
  if (frontmatter.started !== null) return false;
  return frontmatter.status === 'abandoned' || (frontmatter.status === 'pending' && TicketDefaultsUtil.ticketPriorityOf(frontmatter) === 'low');
}

function rowNameOf(frontmatter: Pick<TicketFrontmatter, 'id' | 'title'>): string {
  return `#${frontmatter.id} ${frontmatter.title}`;
}

/**
 * The bar ends at `finished` before `delivered`, because delivery is a later fact about finished work rather than more of it.
 * A delivered ticket was reviewed too, since delivery is only legal from `reviewed`.
 */
function seededFilingOf(frontmatter: Readonly<TicketFrontmatter>): TaskFiling {
  const endTimestamp = frontmatter.finished ?? frontmatter.delivered ?? frontmatter.abandonedAt;
  return {
    name:   rowNameOf(frontmatter),
    ticket: frontmatter.id,
    // A draft stays off the chart, so it is never seeded; were one seeded, it would wait as a pending row.
    status: frontmatter.status === 'draft' ? 'pending' : frontmatter.status,
    ...(frontmatter.started === null ? {} : { start: frontmatter.started }),
    ...(endTimestamp === null ? {} : { end: endTimestamp }),
    ...(frontmatter.status === 'reviewed' || frontmatter.status === 'delivered' ? { reviewed: frontmatter.finished ?? frontmatter.updated } : {}),
  };
}

function reviewBarNameOf(round: number, frontmatter: Pick<TicketFrontmatter, 'id' | 'title'>): string {
  return `Review ${round} #${frontmatter.id} — ${frontmatter.title}`;
}

export const TicketChartUtil = {
  ticketStaysOffTheChart,
  rowNameOf,
  seededFilingOf,
  reviewBarNameOf,
} as const;
