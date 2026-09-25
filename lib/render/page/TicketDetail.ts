/**
 * The panel a Kanban card opens: the ticket's head, its facts, its Timeline and its description. Every value passes `escapeHtml` once,
 * except the ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`.
 */

import { FIRST_REPEAT_REVIEW_ROUND } from '../../constants/Limits.ts';
import type { Task }                 from '../../constants/Types.ts';
import { HtmlEscapeUtil }            from '../../utils/HtmlEscapeUtil.ts';
import type { KanbanCard }           from './KanbanBoard.ts';
import { cardCarriesReviewedMark }   from './KanbanBoard.ts';
import {
  attribute,
  pillLabelForRowState,
  priorityMarkMarkup,
  reviewedMarkMarkup,
  stampMarkup,
  ticketLinksMarkup,
} from './PageMarkup.ts';
import type { TicketTimelineLimits } from './TicketTimeline.ts';
import { ticketTimelineMarkup }      from './TicketTimeline.ts';

const { escapeHtml } = HtmlEscapeUtil;

const HELD_WITHOUT_REASON_TEXT = 'no reason given';

export interface TicketDetailInput {
  card:                 KanbanCard;
  /** The whole progress file's rows, in which the ticket's review rows are looked up. */
  tasks:                readonly Task[];
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  limits:               TicketTimelineLimits;
}

function headMarkup(input: TicketDetailInput): string {
  const { card, limits } = input;
  const { ticket, ownRow } = card;
  const reviewedMark       = ownRow !== null && cardCarriesReviewedMark(card) ? reviewedMarkMarkup(ownRow, limits) : '';
  return [
    `<div class="ap-detail-head" ${attribute('data-state', card.state)}>`,
    `<span class="ap-detail-id">#${escapeHtml(ticket.id)}</span>`,
    `<h2 class="ap-detail-title">${escapeHtml(ticket.title)}</h2>`,
    `<span class="ap-pill">${escapeHtml(pillLabelForRowState(card.state, ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND))}</span>`,
    reviewedMark,
    priorityMarkMarkup(ticket),
    `<span class="ap-detail-type">${escapeHtml(ticket.type)}</span>`,
    '</div>',
  ].join('');
}

function factMarkup(label: string, valueElementMarkup: string): string {
  return `<div><b>${escapeHtml(label)}</b>${valueElementMarkup}</div>`;
}

function factsMarkup(input: TicketDetailInput): string {
  const { card, limits, todayCalendarDate } = input;
  const { ticket, ownRow }                  = card;
  const stamps: Array<[label: string, stamp: string | null | undefined]> = [
    ['filed', ticket.filed],
    ['started', ticket.started],
    ['finished', ticket.finished],
    ['reviewed', ownRow?.reviewed],
    ['delivered', ticket.delivered],
    ['abandoned', ticket.abandonedAt],
  ];
  const facts = stamps.flatMap(([label, stamp]) => (typeof stamp === 'string' && stamp !== ''
    ? [factMarkup(label, stampMarkup('span', stamp, todayCalendarDate, limits))]
    : []));
  if (ticket.reason !== undefined && ticket.reason !== '') facts.push(factMarkup('reason', `<span>${escapeHtml(ticket.reason)}</span>`));
  if (ticket.hold !== undefined) facts.push(factMarkup('held', `<span>${escapeHtml(ticket.hold === '' ? HELD_WITHOUT_REASON_TEXT : ticket.hold)}</span>`));
  if (card.waitingOn.length > 0) facts.push(factMarkup('waiting on', `<span>${ticketLinksMarkup(card.waitingOn, 'kanban-card')}</span>`));
  if (ticket.branch !== undefined && ticket.branch !== '') facts.push(factMarkup('branch', `<span>${escapeHtml(ticket.branch)}</span>`));
  if (ticket.task !== null) {
    facts.push(factMarkup('task', `<span><a ${attribute('href', `#ap-task-${ticket.task}`)}>#${escapeHtml(String(ticket.task))}</a></span>`));
  }
  return `<div class="ap-ticket-meta">${facts.join('')}</div>`;
}

function sectionMarkup(title: string, bodyMarkup: string): string {
  return `<section class="ap-detail-section"><h3 class="ap-detail-section-title">${escapeHtml(title)}</h3>${bodyMarkup}</section>`;
}

export function ticketDetailMarkup(input: TicketDetailInput): string {
  const { card } = input;
  const timeline = ticketTimelineMarkup({
    ticket:               card.ticket,
    tasks:                input.tasks,
    waitingOn:            card.waitingOn,
    nowEpochMilliseconds: input.nowEpochMilliseconds,
    todayCalendarDate:    input.todayCalendarDate,
    limits:               input.limits,
  });
  return [
    headMarkup(input),
    factsMarkup(input),
    sectionMarkup('Timeline', timeline),
    sectionMarkup('Description', `<div class="ap-ticket-body md">${card.ticket.bodyHtml}</div>`),
  ].join('');
}
