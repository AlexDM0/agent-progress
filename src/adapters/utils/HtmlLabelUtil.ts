/**
 * The page's one wording of each ticket status, type and priority it shows, even where the word equals the value: a status as its badge's
 * text, a type as its label, and a priority as its word, a lane group's title and a mark's title.
 */
import type { TicketPriority, TicketStatus, TicketType } from '../../lib/tracker-model/@types/Ticket.ts';

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

const LABEL_FOR_TICKET_TYPE: Readonly<Record<TicketType, string>> = {
  bug:     'bug',
  change:  'change',
  feature: 'feature',
};

const LABEL_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = {
  low:    'low',
  normal: 'normal',
  high:   'high',
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

// The type and the priority arrive as island text too, so each prints as itself when the table does not know it.
function ticketTypeLabelOf(type: TicketType): string {
  return Object.hasOwn(LABEL_FOR_TICKET_TYPE, type) ? LABEL_FOR_TICKET_TYPE[type] : type;
}

function priorityLabelOf(priority: TicketPriority): string {
  return Object.hasOwn(LABEL_FOR_PRIORITY, priority) ? LABEL_FOR_PRIORITY[priority] : priority;
}

export const HtmlLabelUtil = {
  priorityGroupTitleOf,
  priorityMarkTitleOf,
  ticketStatusBadgeTextOf,
  ticketTypeLabelOf,
  priorityLabelOf,
} as const;
