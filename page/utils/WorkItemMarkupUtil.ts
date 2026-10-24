/** How a task or ticket is marked wherever it appears: its links, badges, marks and pill label. */

import { HtmlLabelUtil }                 from '../../src/adapters/utils/HtmlLabelUtil.ts';
import { HtmlEscapeUtil }                from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DisplayState, Task }       from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority }           from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { TicketStatus }             from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { TicketType }               from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }            from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { PageTicket }               from '../../src/shared/@types/PagePayload.ts';
import type { WorkItemLink }             from '../@types/WorkItemLink.ts';
import { CLOSING_EVENT_WORD }            from '../constants/ClosingEventWords.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { MarkupUtil }                    from './MarkupUtil.ts';
import { TemplateIdUtil }                from './TemplateIdUtil.ts';
import type { TimestampSlices }          from './TimeUtil.ts';
import { TimeUtil }                      from './TimeUtil.ts';


/** Where a ticket link leads: the ticket's detail on the Tickets tab, or its card on the Kanban board, which the page script follows itself. */
export type TicketLinkTarget = 'ticket-detail' | 'kanban-card';

export interface ShortenedTexts {
  shortText: string;
  fullText:  string;
}

function ticketLinkOf(identifier: string, target: TicketLinkTarget): WorkItemLink {
  return target === 'kanban-card'
    ? { text: `#${identifier}`, href: `#${TemplateIdUtil.kanbanCardElementIdOf(identifier)}`, hookAttribute: { name: 'data-ticket-link', value: identifier } }
    : { text: `#${identifier}`, href: `#${TemplateIdUtil.ticketFragmentIdOf(identifier)}`, hookAttribute: null };
}

function workItemLinkMarkup(link: WorkItemLink): string {
  const hook = link.hookAttribute === null ? '' : ` ${MarkupUtil.attribute(link.hookAttribute.name, link.hookAttribute.value)}`;
  return `<a ${MarkupUtil.attribute('href', link.href)}${hook}>${HtmlEscapeUtil.escapeHtml(link.text)}</a>`;
}

function ticketLinksMarkup(identifiers: readonly string[], target: TicketLinkTarget = 'ticket-detail'): string {
  return identifiers.map((identifier) => workItemLinkMarkup(ticketLinkOf(identifier, target))).join(', ');
}

/** The link-model form, for a page whose items are not tickets or link elsewhere. */
function waitingOnLinksMarkup(links: readonly WorkItemLink[]): string {
  return links.length === 0 ? '' : `<span class="ap-waiting">waiting on ${links.map(workItemLinkMarkup).join(', ')}</span>`;
}

function waitingOnMarkup(identifiers: readonly string[], target: TicketLinkTarget = 'ticket-detail'): string {
  return waitingOnLinksMarkup(identifiers.map((identifier) => ticketLinkOf(identifier, target)));
}

/** What a row is called on the page: its own ticket, else the ticket it reviews; the row's own id never shows. */
export interface RowLabelSource {
  ticket?:   string | null;
  reviewOf?: string;
}

const TICKETLESS_ROW_LABEL = 'TASK';

function rowLabelOf(row: RowLabelSource): string {
  const ticket = row.ticket ?? row.reviewOf ?? null;
  return ticket === null ? TICKETLESS_ROW_LABEL : `#${ticket}`;
}

const LEADING_TICKET_NUMBER_PATTERN = /^#(\d+)\s+/;

/** A row name opening with its own ticket's `#NNN` drops it, since the label beside it already names the ticket; any other name is kept. */
function displayedRowNameOf(row: { name: string; ticket?: string | null }): string {
  const leadingNumber = LEADING_TICKET_NUMBER_PATTERN.exec(row.name);
  if (row.ticket === undefined || row.ticket === null || leadingNumber === null || Number(leadingNumber[1]) !== Number(row.ticket)) {
    return row.name;
  }
  return row.name.slice(leadingNumber[0].length);
}

function taskLinkMarkup(taskId: number | null, row: RowLabelSource): string {
  return taskId === null ? '' : `<a ${MarkupUtil.attribute('href', `#${TemplateIdUtil.taskRowElementIdOf(taskId)}`)}>${HtmlEscapeUtil.escapeHtml(rowLabelOf(row))}</a>`;
}

function ticketTypeMarkMarkup(type: TicketType): string {
  return `<span class="ap-detail-type" ${MarkupUtil.attribute('data-type', type)}>${HtmlEscapeUtil.escapeHtml(type)}</span>`;
}

function ticketStatusBadgeMarkup(status: TicketStatus): string {
  return `<span class="ap-badge ${HtmlEscapeUtil.escapeHtml(status)}">${HtmlEscapeUtil.escapeHtml(STATE_LABEL_FOR_DISPLAY_STATE[status])}</span>`;
}

/** A state's badge, coloured by `stateToken`, a display state or a value its stylesheet keys on. */
function stateBadgeMarkup(stateToken: string, label: string): string {
  return `<span class="ap-badge" ${MarkupUtil.attribute('data-state', stateToken)}>${HtmlEscapeUtil.escapeHtml(label)}</span>`;
}

/** The one row a table shows when nothing matches: what was asked, already markup, and the way back when something narrowed the table. */
function emptyTableRowMarkup(itemNoun: string, askedPhraseMarkup: string, columnCount: number, offersClearing: boolean): string {
  return `<tr class="ap-table-empty"><td colspan="${columnCount}"><p><strong>No ${HtmlEscapeUtil.escapeHtml(itemNoun)} matches ${askedPhraseMarkup}.</strong></p>`
    + (offersClearing ? '<p><button type="button" class="ap-link-button" data-clear-filters>Clear search and filters</button></p>' : '')
    + '</td></tr>';
}

function markedPriorityMarkup(className: string, priority: 'low' | 'high'): string {
  const title = MarkupUtil.attribute('title', HtmlLabelUtil.priorityMarkTitleOf(priority));
  return `<span class="${className}" data-priority="${priority}" ${title}>${HtmlEscapeUtil.escapeHtml(priority)}</span>`;
}

/** Normal is unmarked. Low borrows the row's quiet ticket badge and high the amber "waiting on" note: the template has no priority style of its own. */
function priorityLevelMarkMarkup(priority: TicketPriority): string {
  if (priority === 'low') return markedPriorityMarkup('ap-ticket-badge', 'low');
  if (priority === 'high') return markedPriorityMarkup('ap-waiting', 'high');
  return '';
}

function priorityMarkMarkup(ticket: PageTicket): string {
  return priorityLevelMarkMarkup(TicketDefaultsUtil.ticketPriorityOf(ticket));
}

function reviewedTitleOf(task: Pick<Task, 'reviewed'>, slices: TimestampSlices): string {
  return task.reviewed === undefined ? 'Reviewed before it was done' : `Reviewed ${TimeUtil.fullStampText(task.reviewed, slices)} before it was done`;
}

function titledReviewedMarkMarkup(title: string): string {
  return `<span class="ap-reviewed-mark" data-state="reviewed" ${MarkupUtil.attribute('title', title)} role="img" aria-label="reviewed">✓</span>`;
}

function reviewedMarkMarkup(task: Pick<Task, 'reviewed'>, slices: TimestampSlices): string {
  return titledReviewedMarkMarkup(reviewedTitleOf(task, slices));
}

function stateLabelOf(state: DisplayState, reviewRound: number): string {
  const label = STATE_LABEL_FOR_DISPLAY_STATE[state];
  return state === 're-review' ? `${label} (round ${reviewRound})` : label;
}

/** The newest of the ticket's closing, finishing, starting and filing stamps, labelled, shortened against today and in full. */
function latestMilestoneTextsOf(ticket: PageTicket, slices: TimestampSlices, todayCalendarDate: string): ShortenedTexts | null {
  const milestones: Array<[label: string, value: string | null | undefined]> = [
    [CLOSING_EVENT_WORD.delivered, ticket.delivered],
    [CLOSING_EVENT_WORD.abandoned, ticket.abandonedAt],
    ['finished', ticket.finished],
    ['started', ticket.started],
    ['filed', ticket.filed],
  ];
  for (const [label, value] of milestones) {
    if (typeof value === 'string' && value !== '') {
      return { shortText: `${label} ${TimeUtil.shortStampText(value, todayCalendarDate, slices)}`, fullText: `${label} ${TimeUtil.fullStampText(value, slices)}` };
    }
  }
  return null;
}

/** The Kanban card sets it under its own class. */
function latestMilestoneMarkup(ticket: PageTicket, slices: TimestampSlices, todayCalendarDate: string, className = 'ap-ticket-dates'): string {
  const texts = latestMilestoneTextsOf(ticket, slices, todayCalendarDate);
  return texts === null ? '' : MarkupUtil.shortenedTextMarkup('span', texts.shortText, texts.fullText, className);
}

export const WorkItemMarkupUtil = {
  ticketLinkOf,
  ticketLinksMarkup,
  waitingOnLinksMarkup,
  waitingOnMarkup,
  rowLabelOf,
  displayedRowNameOf,
  taskLinkMarkup,
  ticketStatusBadgeMarkup,
  stateBadgeMarkup,
  emptyTableRowMarkup,
  ticketTypeMarkMarkup,
  priorityLevelMarkMarkup,
  priorityMarkMarkup,
  reviewedTitleOf,
  titledReviewedMarkMarkup,
  reviewedMarkMarkup,
  stateLabelOf,
  latestMilestoneTextsOf,
  latestMilestoneMarkup,
} as const;
