/** How a task or ticket is marked wherever it appears: its links, badges, marks and pill label. */

import { HtmlLabelUtil }            from '../../src/adapters/utils/HtmlLabelUtil.ts';
import type { Task }                from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }        from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }       from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import { HtmlEscapeUtil }           from '../../src/lib/utils/HtmlEscapeUtil.ts';
import type { PageTicket }          from '../../src/shared/@types/PagePayload.ts';
import type { RowState }            from '../constants/RowState.ts';
import { PILL_LABEL_FOR_ROW_STATE } from '../constants/RowState.ts';
import { MarkupUtil }               from './MarkupUtil.ts';
import type { TimestampSlices }     from './TimeUtil.ts';
import { TimeUtil }                 from './TimeUtil.ts';


/** Where a ticket link leads: the ticket's card on the Tickets tab, or its card on the Kanban board, which the page script follows itself. */
export type TicketLinkTarget = 'ticket-card' | 'kanban-card';

function ticketLinkMarkup(identifier: string, target: TicketLinkTarget): string {
  const destination = target === 'kanban-card'
    ? `${MarkupUtil.attribute('href', `#ap-kanban-${identifier}`)} ${MarkupUtil.attribute('data-ticket-link', identifier)}`
    : MarkupUtil.attribute('href', `#ap-ticket-${identifier}`);
  return `<a ${destination}>#${HtmlEscapeUtil.escapeHtml(identifier)}</a>`;
}

function ticketLinksMarkup(identifiers: readonly string[], target: TicketLinkTarget = 'ticket-card'): string {
  return identifiers.map((identifier) => ticketLinkMarkup(identifier, target)).join(', ');
}

function waitingOnMarkup(identifiers: readonly string[], target: TicketLinkTarget = 'ticket-card'): string {
  return identifiers.length === 0 ? '' : `<span class="ap-waiting">waiting on ${ticketLinksMarkup(identifiers, target)}</span>`;
}

function taskLinkMarkup(taskId: number | null): string {
  return taskId === null ? '' : `<a ${MarkupUtil.attribute('href', `#ap-task-${taskId}`)}>#${HtmlEscapeUtil.escapeHtml(String(taskId))}</a>`;
}

function ticketBadgeMarkup(ticketId: string): string {
  return `<a class="ap-ticket-badge" ${MarkupUtil.attribute('href', `#ap-ticket-${ticketId}`)}>#${HtmlEscapeUtil.escapeHtml(ticketId)}</a>`;
}

function ticketStatusBadgeMarkup(status: TicketStatus): string {
  return `<span class="ap-badge ${HtmlEscapeUtil.escapeHtml(status)}">${HtmlEscapeUtil.escapeHtml(status)}</span>`;
}

/** Normal is unmarked. Low borrows the row's quiet ticket badge and high the amber "waiting on" note: the template has no priority style of its own. */
function priorityMarkMarkup(ticket: PageTicket): string {
  const priority = TicketDefaultsUtil.ticketPriorityOf(ticket);
  if (priority === 'low') {
    return `<span class="ap-ticket-badge" data-priority="low" ${MarkupUtil.attribute('title', HtmlLabelUtil.priorityMarkTitleOf('low'))}>low</span>`;
  }
  if (priority === 'high') {
    return `<span class="ap-waiting" data-priority="high" ${MarkupUtil.attribute('title', HtmlLabelUtil.priorityMarkTitleOf('high'))}>high</span>`;
  }
  return '';
}

function reviewedTitleFor(task: Task, slices: TimestampSlices): string {
  return task.reviewed === undefined ? 'Reviewed before delivery' : `Reviewed ${TimeUtil.fullStampText(task.reviewed, slices)} before delivery`;
}

function reviewedMarkMarkup(task: Task, slices: TimestampSlices): string {
  return `<span class="ap-reviewed-mark" data-state="reviewed" ${MarkupUtil.attribute('title', reviewedTitleFor(task, slices))} role="img" aria-label="reviewed">✓</span>`;
}

function pillLabelForRowState(state: RowState, reviewRound: number): string {
  const label = PILL_LABEL_FOR_ROW_STATE[state];
  return state === 're-review' ? `${label} ${reviewRound}` : label;
}

/** The newest of the ticket's closing, finishing, starting and filing stamps, labelled; the Kanban card sets it under its own class. */
function latestMilestoneMarkup(ticket: PageTicket, slices: TimestampSlices, todayCalendarDate: string, className = 'ap-ticket-dates'): string {
  const milestones: Array<[label: string, value: string | null | undefined]> = [
    ['delivered', ticket.delivered],
    ['abandoned', ticket.abandonedAt],
    ['finished', ticket.finished],
    ['started', ticket.started],
    ['filed', ticket.filed],
  ];
  for (const [label, value] of milestones) {
    if (typeof value === 'string' && value !== '') {
      return MarkupUtil.shortenedTextMarkup(
        'span',
        `${label} ${TimeUtil.shortStampText(value, todayCalendarDate, slices)}`,
        `${label} ${TimeUtil.fullStampText(value, slices)}`,
        className,
      );
    }
  }
  return '';
}

export const WorkItemMarkupUtil = {
  ticketLinksMarkup,
  waitingOnMarkup,
  taskLinkMarkup,
  ticketBadgeMarkup,
  ticketStatusBadgeMarkup,
  priorityMarkMarkup,
  reviewedMarkMarkup,
  pillLabelForRowState,
  latestMilestoneMarkup,
} as const;
