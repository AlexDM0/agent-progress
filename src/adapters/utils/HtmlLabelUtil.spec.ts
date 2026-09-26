/**
 * The group titles divide a Kanban lane by priority, the mark titles are the tooltips of a low or a high ticket's mark, and the badge
 * text is a ticket status's badge. What the page relies on: every priority has a group title, every status has a badge text, and every
 * wording stays byte for byte what the page printed before it moved here.
 * The frozen tables were retaken from `PRIORITY_TITLE` in `git show 4ebbb73:page/kanban/KanbanMarkup.ts` and from `LOW_PRIORITY_TITLE`
 * and `HIGH_PRIORITY_TITLE` in `git show 4ebbb73:page/utils/WorkItemMarkupUtil.ts`.
 */
import { expect, test } from 'bun:test';

import type { TicketPriority, TicketStatus } from '../../lib/tracker-model/@types/Ticket';
import { TICKET_STATUSES }                   from '../../lib/tracker-model/constants/Statuses';
import { TICKET_PRIORITIES }                 from '../../lib/tracker-model/constants/TicketFields';
import { HtmlLabelUtil }                     from './HtmlLabelUtil';

const EXPECTED_GROUP_TITLE_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = Object.freeze({
  high:   'High',
  normal: 'Normal',
  low:    'Low',
});

const EXPECTED_MARK_TITLE_FOR_PRIORITY: Readonly<Record<'low' | 'high', string>> = Object.freeze({
  low:  'Low priority: no row on the chart until it is started, and worked once no normal or high ticket is left undelivered',
  high: 'High priority: dispatched before every normal ticket',
});

// Retaken from `git show 457dcf4:page/utils/WorkItemMarkupUtil.ts`: before this table, the badge printed the status itself.
const EXPECTED_BADGE_TEXT_FOR_TICKET_STATUS: Readonly<Record<TicketStatus, string>> = Object.freeze({
  'pending':     'pending',
  'in-progress': 'in-progress',
  'in-review':   'in-review',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
  'abandoned':   'abandoned',
});

test('each priority is titled as the lane group it has always headed', () => {
  expect(Object.keys(EXPECTED_GROUP_TITLE_FOR_PRIORITY).sort()).toEqual([...TICKET_PRIORITIES].sort());
  for (const priority of TICKET_PRIORITIES) expect(HtmlLabelUtil.priorityGroupTitleOf(priority), priority).toBe(EXPECTED_GROUP_TITLE_FOR_PRIORITY[priority]);
});

test('a low and a high mark carry the titles they have always carried', () => {
  expect(HtmlLabelUtil.priorityMarkTitleOf('low')).toBe(EXPECTED_MARK_TITLE_FOR_PRIORITY.low);
  expect(HtmlLabelUtil.priorityMarkTitleOf('high')).toBe(EXPECTED_MARK_TITLE_FOR_PRIORITY.high);
});

test('words every ticket status as the badge main\'s page printed', () => {
  expect(Object.keys(EXPECTED_BADGE_TEXT_FOR_TICKET_STATUS).sort()).toEqual([...TICKET_STATUSES].sort());
  for (const status of TICKET_STATUSES) expect(HtmlLabelUtil.ticketStatusBadgeTextOf(status), status).toBe(EXPECTED_BADGE_TEXT_FOR_TICKET_STATUS[status]);
});

test('prints a status from the island that the table does not know as itself', () => {
  expect(HtmlLabelUtil.ticketStatusBadgeTextOf('shipped' as TicketStatus)).toBe('shipped');
});
