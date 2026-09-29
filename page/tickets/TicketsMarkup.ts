/**
 * The Tickets tab's markup: the table rows with the search's matches marked, the empty result, the chips and the count, shaped by the
 * placeholder content of `resources/template.html`. Every ticket value passes `escapeHtml` exactly once here.
 */

import { HtmlEscapeUtil }                    from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { TicketType }                   from '../../src/lib/tracker-model/@types/Ticket.ts';
import { FIRST_REPEAT_REVIEW_ROUND }         from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { TicketDefaultsUtil }                from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { PageTicket }                   from '../../src/shared/@types/PagePayload.ts';
import type { BoardTicket }                  from '../@types/PageBoard.ts';
import type { TicketStatusChip, TicketView } from '../@types/ViewerChoices.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }     from '../constants/StateLabels.ts';
import { MarkupUtil }                        from '../utils/MarkupUtil.ts';
import { WorkItemMarkupUtil }                from '../utils/WorkItemMarkupUtil.ts';
import { TicketViewUtil }                    from './utils/TicketViewUtil.ts';

const TICKET_TABLE_COLUMN_COUNT = 7;

/** The Tickets tab sets the quiet low badge one space off the title before it; the amber high mark carries its own margin. */
function ticketsTabPriorityMarkMarkup(ticket: PageTicket): string {
  const mark = WorkItemMarkupUtil.priorityMarkMarkup(ticket);
  return TicketDefaultsUtil.ticketPriorityOf(ticket) === 'low' ? ` ${mark}` : mark;
}

/**
 * The text escaped, with each case-insensitive occurrence of the query wrapped in a mark. The text is split before it is escaped, so a
 * query can never match inside an entity; a text whose lower case changes its length is left unmarked rather than marked off by one.
 */
export function matchMarkedMarkup(text: string, query: string): string {
  const lowerText = text.toLowerCase();
  if (query === '' || lowerText.length !== text.length) {
    return HtmlEscapeUtil.escapeHtml(text);
  }
  const pieces: string[] = [];
  let position           = 0;
  let matchStart         = lowerText.indexOf(query);
  while (matchStart !== -1) {
    pieces.push(HtmlEscapeUtil.escapeHtml(text.slice(position, matchStart)));
    pieces.push(`<mark class="ap-match">${HtmlEscapeUtil.escapeHtml(text.slice(matchStart, matchStart + query.length))}</mark>`);
    position   = matchStart + query.length;
    matchStart = lowerText.indexOf(query, position);
  }
  pieces.push(HtmlEscapeUtil.escapeHtml(text.slice(position)));
  return pieces.join('');
}

function displayStateBadgeMarkup(ticket: BoardTicket): string {
  const label = WorkItemMarkupUtil.stateLabelOf(ticket.displayState, ticket.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
  return `<span class="ap-badge" ${MarkupUtil.attribute('data-state', ticket.displayState)}>${HtmlEscapeUtil.escapeHtml(label)}</span>`;
}

/** An id query marks nothing: the digits it looks for are the whole id column's. */
export function ticketTableRowsMarkup(tickets: readonly BoardTicket[], searchText: string): string {
  const query       = TicketViewUtil.normalisedQueryOf(searchText);
  const markedQuery = TicketViewUtil.queryNamesATicketId(query) ? '' : query;
  return tickets.map((ticket) => [
    `<tr ${MarkupUtil.attribute('data-ticket-id', ticket.id)} ${MarkupUtil.attribute('data-state', ticket.displayState)} tabindex="0">`,
    `<td class="mono">${WorkItemMarkupUtil.ticketLinksMarkup([ticket.id])}</td>`,
    `<td>${matchMarkedMarkup(ticket.title, markedQuery)}${ticketsTabPriorityMarkMarkup(ticket)}${WorkItemMarkupUtil.waitingOnMarkup(ticket.waitingOn)}</td>`,
    `<td>${HtmlEscapeUtil.escapeHtml(ticket.type)}</td>`,
    `<td>${displayStateBadgeMarkup(ticket)}</td>`,
    `<td>${matchMarkedMarkup(ticket.group ?? '', markedQuery)}</td>`,
    `<td class="mono">${matchMarkedMarkup(ticket.branch ?? '', markedQuery)}</td>`,
    `<td class="mono">${WorkItemMarkupUtil.taskLinkMarkup(ticket.task)}</td>`,
    '</tr>',
  ].join('')).join('');
}

function activeFiltersPhrase(view: TicketView): string {
  const parts: string[] = [];
  const query           = view.searchText.trim();
  if (query !== '') {
    parts.push(`“${HtmlEscapeUtil.escapeHtml(query)}”`);
  }
  if (view.statusChips.length > 0) {
    parts.push(`status ${view.statusChips.map((chip) => HtmlEscapeUtil.escapeHtml(STATE_LABEL_FOR_DISPLAY_STATE[chip])).join(' or ')}`);
  }
  if (view.typeChips.length > 0) {
    parts.push(`type ${view.typeChips.map((type) => HtmlEscapeUtil.escapeHtml(type)).join(' or ')}`);
  }
  return parts.join(', ');
}

/** The one row a table shows when nothing matches: what was asked, and the way back. */
export function emptyTicketTableMarkup(view: TicketView): string {
  const asked = TicketViewUtil.viewNarrows(view) ? activeFiltersPhrase(view) : 'the view';
  return `<tr class="ap-table-empty"><td colspan="${TICKET_TABLE_COLUMN_COUNT}"><p><strong>No ticket matches ${asked}.</strong></p>`
    + (TicketViewUtil.viewNarrows(view) ? '<p><button type="button" class="ap-link-button" data-clear-filters>Clear search and filters</button></p>' : '')
    + '</td></tr>';
}

export function statusChipsMarkup(chips: readonly TicketStatusChip[]): string {
  return chips.map((chip) => [
    `<button type="button" class="ap-chip" ${MarkupUtil.attribute('data-status', chip)} ${MarkupUtil.attribute('data-state', chip)} aria-pressed="false">`,
    `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', chip)}></span>${HtmlEscapeUtil.escapeHtml(STATE_LABEL_FOR_DISPLAY_STATE[chip])} `,
    '<span class="ap-chip-count"></span></button>',
  ].join('')).join('');
}

export function typeChipsMarkup(types: readonly TicketType[]): string {
  return types.map((type) => (
    `<button type="button" class="ap-chip" ${MarkupUtil.attribute('data-type', type)} aria-pressed="false">`
    + `${HtmlEscapeUtil.escapeHtml(type)} <span class="ap-chip-count"></span></button>`
  )).join('');
}

export function ticketCountText(shownCount: number, allTickets: readonly PageTicket[]): string {
  if (allTickets.length === 0) {
    return 'no tickets';
  }
  const inProgressCount = allTickets.filter((ticket) => ticket.status === 'in-progress').length;
  const total           = `${shownCount} of ${allTickets.length} ticket${allTickets.length === 1 ? '' : 's'}`;
  return inProgressCount === 0 ? total : `${total} · ${inProgressCount} in progress`;
}
