/** Where a ticket stands on the chart: whether it has a row to be given at all, the names its rows are stored under, and the row it is seeded as. */
import type { TicketFrontmatter, TicketStatus } from '../@types/Ticket.ts';
import type { TaskFiling }                      from './TaskFilingUtil.ts';
import { TicketDefaultsUtil }                   from './TicketDefaultsUtil.ts';

/** A low ticket that was never started lives off the chart; once started it keeps the row it was given. */
const TICKET_STATUSES_A_LOW_TICKET_WAITS_OFF_THE_CHART_IN: readonly TicketStatus[] = ['pending', 'abandoned'];

function ticketStaysOffTheChart(frontmatter: Pick<TicketFrontmatter, 'priority' | 'started' | 'status'>): boolean {
  return TicketDefaultsUtil.ticketPriorityOf(frontmatter) === 'low'
    && frontmatter.started === null
    && TICKET_STATUSES_A_LOW_TICKET_WAITS_OFF_THE_CHART_IN.includes(frontmatter.status);
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
    status: frontmatter.status,
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
