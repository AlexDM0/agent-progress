/**
 * The page's words for the model values that need wording: a ticket priority as a lane group's title and as a mark's title, and a ticket
 * status as its badge's text.
 */
import type { TicketPriority, TicketStatus } from '../../lib/tracker-model/@types/Ticket.ts';

const GROUP_TITLE_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = { high: 'High', normal: 'Normal', low: 'Low' };

// Normal is unmarked, so only low and high carry a mark with a title.
const MARK_TITLE_FOR_PRIORITY: Readonly<Record<'low' | 'high', string>> = {
  low:  'Low priority: no row on the chart until it is started, and worked once no normal or high ticket is left undelivered',
  high: 'High priority: dispatched before every normal ticket',
};

const BADGE_TEXT_FOR_TICKET_STATUS: Readonly<Record<TicketStatus, string>> = {
  'pending':     'pending',
  'in-progress': 'in-progress',
  'in-review':   'in-review',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
  'abandoned':   'abandoned',
};

function priorityGroupTitleOf(priority: TicketPriority): string {
  return GROUP_TITLE_FOR_PRIORITY[priority];
}

function priorityMarkTitleOf(priority: 'low' | 'high'): string {
  return MARK_TITLE_FOR_PRIORITY[priority];
}

// The status arrives as island text, so one the table does not know prints as itself.
function ticketStatusBadgeTextOf(status: TicketStatus): string {
  return Object.hasOwn(BADGE_TEXT_FOR_TICKET_STATUS, status) ? BADGE_TEXT_FOR_TICKET_STATUS[status] : status;
}

export const HtmlLabelUtil = { priorityGroupTitleOf, priorityMarkTitleOf, ticketStatusBadgeTextOf } as const;
