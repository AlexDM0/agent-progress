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
import { filterChipMarkup }                  from '../chips/FilterChipMarkup.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }     from '../constants/StateLabels.ts';
import { EpicMarkup }                        from '../epics/EpicMarkup.ts';
import { CARD_EPIC_CHIP_LIMIT }              from '../epics/GroupMarkup.ts';
import { IntegrationMarkupUtil }             from '../utils/IntegrationMarkupUtil.ts';
import { MarkupUtil }                        from '../utils/MarkupUtil.ts';
import type { PauseTextFormat }              from '../utils/PauseTextUtil.ts';
import { PauseTextUtil }                     from '../utils/PauseTextUtil.ts';
import { WorkItemMarkupUtil }                from '../utils/WorkItemMarkupUtil.ts';
import { SearchMarkUtil }                    from './utils/SearchMarkUtil.ts';
import { TicketViewUtil }                    from './utils/TicketViewUtil.ts';

/** The Tickets tab sets the quiet low badge one space off the title before it; the amber high mark carries its own margin. */
function ticketsTabPriorityMarkMarkup(ticket: PageTicket): string {
  const mark = WorkItemMarkupUtil.priorityMarkMarkup(ticket);
  return TicketDefaultsUtil.ticketPriorityOf(ticket) === 'low' ? ` ${mark}` : mark;
}

function displayStateBadgeMarkup(ticket: BoardTicket): string {
  return WorkItemMarkupUtil.stateBadgeMarkup(ticket.displayState, WorkItemMarkupUtil.stateLabelOf(ticket.displayState, ticket.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND));
}

/** A paused build's since and duration beside its badge, the row's note on hover. */
function pauseGapMarkup(ticket: BoardTicket, format: PauseTextFormat): string {
  const pauseText = ticket.displayState === 'paused' ? PauseTextUtil.pauseTextOf(ticket.ownRow, format) : null;
  if (pauseText === null) {
    return '';
  }
  const rowNote = ticket.ownRow?.note ?? '';
  return `<span class="ap-detail-gap"${rowNote === '' ? '' : ` ${MarkupUtil.attribute('title', rowNote)}`}>${HtmlEscapeUtil.escapeHtml(pauseText)}</span>`;
}

/** The table's columns without the Epic column, which shows only on a board with epics. */
const TICKET_TABLE_COLUMN_COUNT_WITHOUT_EPICS = 6;

export function ticketTableColumnCountOf(showsEpicColumn: boolean): number {
  return TICKET_TABLE_COLUMN_COUNT_WITHOUT_EPICS + (showsEpicColumn ? 1 : 0);
}

export interface TicketTableRowsOptions {
  format:          PauseTextFormat;
  showsEpicColumn: boolean;
  /** Every ticket, which a grouped ticket's branch mark reads its group's release from. */
  allTickets:      readonly PageTicket[];
}

/** An id query marks nothing: the digits it looks for are the whole id column's. */
export function ticketTableRowsMarkup(tickets: readonly BoardTicket[], searchText: string, options: TicketTableRowsOptions): string {
  const query       = SearchMarkUtil.normalisedQueryOf(searchText);
  const markedQuery = TicketViewUtil.queryNamesATicketId(query) ? '' : query;
  return tickets.map((ticket) => [
    `<tr ${MarkupUtil.attribute('data-ticket-id', ticket.id)} ${MarkupUtil.attribute('data-state', ticket.displayState)} tabindex="0">`,
    `<td class="mono">${WorkItemMarkupUtil.ticketLinksMarkup([ticket.id])}</td>`,
    `<td>${SearchMarkUtil.matchMarkedMarkup(ticket.title, markedQuery)}${ticketsTabPriorityMarkMarkup(ticket)}`,
    `${IntegrationMarkupUtil.integrationMarkMarkup(ticket, options.allTickets, SearchMarkUtil.matchMarkedMarkup(ticket.group ?? '', markedQuery))}`,
    `${WorkItemMarkupUtil.waitingOnMarkup(ticket.waitingOn)}</td>`,
    options.showsEpicColumn ? `<td><span class="ap-epic-chips">${EpicMarkup.epicChipsMarkup(ticket.memberOfEpics, CARD_EPIC_CHIP_LIMIT)}</span></td>` : '',
    `<td>${HtmlEscapeUtil.escapeHtml(ticket.type)}</td>`,
    `<td>${displayStateBadgeMarkup(ticket)}${pauseGapMarkup(ticket, options.format)}</td>`,
    `<td class="mono">${SearchMarkUtil.matchMarkedMarkup(ticket.branch ?? '', markedQuery)}</td>`,
    `<td class="mono">${WorkItemMarkupUtil.taskLinkMarkup(ticket.task)}</td>`,
    '</tr>',
  ].join('')).join('');
}

function activeFiltersPhrase(view: TicketView, epicChipLabelOf: (chip: string) => string): string {
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
  if (view.epicChips.length > 0) {
    parts.push(`epic ${view.epicChips.map((chip) => HtmlEscapeUtil.escapeHtml(epicChipLabelOf(chip))).join(' or ')}`);
  }
  return parts.join(', ');
}

/** The one row a table shows when nothing matches: what was asked, and the way back. */
export function emptyTicketTableMarkup(view: TicketView, columnCount: number, epicChipLabelOf: (chip: string) => string): string {
  const narrows = TicketViewUtil.viewNarrows(view);
  return WorkItemMarkupUtil.emptyTableRowMarkup('ticket', narrows ? activeFiltersPhrase(view, epicChipLabelOf) : 'the view', columnCount, narrows);
}

export function statusChipsMarkup(chips: readonly TicketStatusChip[]): string {
  return chips.map((chip) => filterChipMarkup('data-status', { value: chip, label: STATE_LABEL_FOR_DISPLAY_STATE[chip], stateToken: chip })).join('');
}

export function typeChipsMarkup(types: readonly TicketType[]): string {
  return types.map((type) => filterChipMarkup('data-type', { value: type, label: type })).join('');
}

export function ticketCountText(shownCount: number, allTickets: readonly PageTicket[]): string {
  if (allTickets.length === 0) {
    return 'no tickets';
  }
  const inProgressCount = allTickets.filter((ticket) => ticket.status === 'in-progress').length;
  const total           = `${shownCount} of ${allTickets.length} ticket${allTickets.length === 1 ? '' : 's'}`;
  return inProgressCount === 0 ? total : `${total} · ${inProgressCount} in progress`;
}
