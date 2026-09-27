/**
 * The group titles divide a Kanban lane by priority, and the mark titles are the tooltips of a low or a high ticket's mark. What the page
 * relies on: every priority has a group title, and every wording stays byte for byte what the page printed before it moved here.
 * The frozen tables were retaken from `PRIORITY_TITLE` in `git show 4ebbb73:page/kanban/KanbanMarkup.ts` and from `LOW_PRIORITY_TITLE`
 * and `HIGH_PRIORITY_TITLE` in `git show 4ebbb73:page/utils/WorkItemMarkupUtil.ts`.
 */
import { expect, test } from 'bun:test';

import type { TicketPriority } from '../../lib/tracker-model/@types/Ticket.ts';
import { TICKET_PRIORITIES }   from '../../lib/tracker-model/constants/TicketFields.ts';
import { HtmlLabelUtil }       from './HtmlLabelUtil.ts';

const EXPECTED_GROUP_TITLE_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = Object.freeze({
  high:   'High',
  normal: 'Normal',
  low:    'Low',
});

const EXPECTED_MARK_TITLE_FOR_PRIORITY: Readonly<Record<'low' | 'high', string>> = Object.freeze({
  low:  'Low priority: no row on the chart until it is started, and worked once no normal or high ticket is left undelivered',
  high: 'High priority: dispatched before every normal ticket',
});

test('each priority is titled as the lane group it has always headed', () => {
  expect(Object.keys(EXPECTED_GROUP_TITLE_FOR_PRIORITY).sort()).toEqual([...TICKET_PRIORITIES].sort());
  for (const priority of TICKET_PRIORITIES) expect(HtmlLabelUtil.priorityGroupTitleOf(priority), priority).toBe(EXPECTED_GROUP_TITLE_FOR_PRIORITY[priority]);
});

test('a low and a high mark carry the titles they have always carried', () => {
  expect(HtmlLabelUtil.priorityMarkTitleOf('low')).toBe(EXPECTED_MARK_TITLE_FOR_PRIORITY.low);
  expect(HtmlLabelUtil.priorityMarkTitleOf('high')).toBe(EXPECTED_MARK_TITLE_FOR_PRIORITY.high);
});
