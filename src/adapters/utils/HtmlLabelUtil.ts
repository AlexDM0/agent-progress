/**
 * The page's words for a priority that differ from the value: a lane group's title and a mark's title. A status, a type and a priority
 * word print as their values.
 */
import type { TicketPriority } from '../../lib/tracker-model/@types/Ticket.ts';

const GROUP_TITLE_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = { high: 'High', normal: 'Normal', low: 'Low' };

// Normal is unmarked, so only low and high carry a mark with a title.
const MARK_TITLE_FOR_PRIORITY: Readonly<Record<'low' | 'high', string>> = {
  low:  'Low priority: no row on the chart until it is started, and worked once no normal or high ticket is left undelivered',
  high: 'High priority: dispatched before every normal ticket',
};

function priorityGroupTitleOf(priority: TicketPriority): string {
  return GROUP_TITLE_FOR_PRIORITY[priority];
}

function priorityMarkTitleOf(priority: 'low' | 'high'): string {
  return MARK_TITLE_FOR_PRIORITY[priority];
}

export const HtmlLabelUtil = {
  priorityGroupTitleOf,
  priorityMarkTitleOf,
} as const;
