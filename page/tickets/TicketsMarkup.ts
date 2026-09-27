/**
 * The Tickets tab's markup: the table rows, the cards and the count, shaped by the placeholder content of `resources/template.html`. Every
 * ticket value passes `escapeHtml` exactly once here, except a ticket's `bodyHtml`, already escaped by `src/services/render/MarkdownRenderer.ts`.
 */

import { HtmlEscapeUtil }                      from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TICKET_STATUSES_THAT_CLOSE_A_TICKET } from '../../src/lib/tracker-model/constants/Statuses.ts';
import { TicketDefaultsUtil }                  from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { PageTicket }                     from '../../src/shared/@types/PagePayload.ts';
import { MarkupUtil }                          from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                      from '../utils/TemplateIdUtil.ts';
import type { TimestampSlices }                from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }                  from '../utils/WorkItemMarkupUtil.ts';


/** The Tickets tab sets the quiet low badge one space off the title or status badge before it; the amber high mark carries its own margin. */
function ticketsTabPriorityMarkMarkup(ticket: PageTicket): string {
  const mark = WorkItemMarkupUtil.priorityMarkMarkup(ticket);
  return TicketDefaultsUtil.ticketPriorityOf(ticket) === 'low' ? ` ${mark}` : mark;
}

export function ticketTableRowsMarkup(tickets: readonly PageTicket[], waitingOnById: ReadonlyMap<string, readonly string[]>): string {
  return tickets.map((ticket) => [
    `<tr ${MarkupUtil.attribute('data-ticket-id', ticket.id)} tabindex="0">`,
    `<td class="mono">${WorkItemMarkupUtil.ticketLinksMarkup([ticket.id])}</td>`,
    `<td>${HtmlEscapeUtil.escapeHtml(ticket.title)}${ticketsTabPriorityMarkMarkup(ticket)}${WorkItemMarkupUtil.waitingOnMarkup(waitingOnById.get(ticket.id) ?? [])}</td>`,
    `<td>${HtmlEscapeUtil.escapeHtml(ticket.type)}</td>`,
    `<td>${WorkItemMarkupUtil.ticketStatusBadgeMarkup(ticket.status)}</td>`,
    `<td>${HtmlEscapeUtil.escapeHtml(ticket.group ?? '')}</td>`,
    `<td class="mono">${HtmlEscapeUtil.escapeHtml(ticket.branch ?? '')}</td>`,
    `<td class="mono">${WorkItemMarkupUtil.taskLinkMarkup(ticket.task)}</td>`,
    '</tr>',
  ].join('')).join('');
}

export function ticketCountText(tickets: readonly PageTicket[]): string {
  if (tickets.length === 0) {
    return 'no tickets';
  }
  const inProgressCount = tickets.filter((ticket) => ticket.status === 'in-progress').length;
  const total           = `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;
  return inProgressCount === 0 ? total : `${total} · ${inProgressCount} in progress`;
}

function ticketMetadataMarkup(ticket: PageTicket, slices: TimestampSlices, todayCalendarDate: string): string {
  // Tuples rather than records: the page bundle keeps every property name, and this table is its longest run of them.
  const entries: Array<[label: string, value: string | null | undefined, isTimestamp: boolean]> = [
    ['filed', ticket.filed, true],
    ['started', ticket.started, true],
    ['finished', ticket.finished, true],
    ['delivered', ticket.delivered, true],
    ['abandoned', ticket.abandonedAt, true],
    ['branch', ticket.branch, false],
    ['commit', ticket.commit, false],
    ['reason', ticket.reason, false],
  ];
  const shown = entries
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([label, value, isTimestamp]) => {
      const text        = value ?? '';
      const valueMarkup = isTimestamp ? MarkupUtil.stampMarkup('span', text, todayCalendarDate, slices) : `<span>${HtmlEscapeUtil.escapeHtml(text)}</span>`;
      return `<div><b>${HtmlEscapeUtil.escapeHtml(label)}</b>${valueMarkup}</div>`;
    })
    .join('');
  const taskEntry       = ticket.task === null ? '' : `<div><b>task</b><span>${WorkItemMarkupUtil.taskLinkMarkup(ticket.task)}</span></div>`;
  const dependsOn       = ticket.dependsOn ?? [];
  const dependencyEntry = dependsOn.length === 0 ? '' : `<div><b>waits on</b><span>${WorkItemMarkupUtil.ticketLinksMarkup(dependsOn)}</span></div>`;
  return `<div class="ap-ticket-meta">${shown}${taskEntry}${dependencyEntry}</div>`;
}

function ticketCardMarkup(ticket: PageTicket, waitingOn: readonly string[], slices: TimestampSlices, todayCalendarDate: string): string {
  const head = [
    `<span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`,
    `<h3 class="ap-ticket-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}</h3>`,
    WorkItemMarkupUtil.ticketStatusBadgeMarkup(ticket.status),
    ticketsTabPriorityMarkMarkup(ticket),
    WorkItemMarkupUtil.waitingOnMarkup(waitingOn),
    WorkItemMarkupUtil.latestMilestoneMarkup(ticket, slices, todayCalendarDate),
  ].join('');
  const body  = `${ticketMetadataMarkup(ticket, slices, todayCalendarDate)}<div class="ap-ticket-body md">${ticket.bodyHtml}</div>`;
  const inner = TICKET_STATUSES_THAT_CLOSE_A_TICKET.includes(ticket.status)
    ? `<details><summary>${head}</summary>${body}</details>`
    : `<div class="ap-ticket-head">${head}</div>${body}`;
  return `<section class="ap-ticket" ${MarkupUtil.attribute('id', TemplateIdUtil.ticketCardElementIdOf(ticket.id))}>${inner}</section>`;
}

export function ticketCardsMarkup(
  tickets: readonly PageTicket[],
  waitingOnById: ReadonlyMap<string, readonly string[]>,
  slices: TimestampSlices,
  todayCalendarDate: string,
): string {
  return tickets.map((ticket) => ticketCardMarkup(ticket, waitingOnById.get(ticket.id) ?? [], slices, todayCalendarDate)).join('');
}
