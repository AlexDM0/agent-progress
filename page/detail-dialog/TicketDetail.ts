/**
 * The panel a Kanban card opens: the ticket's head, its facts, its Timeline and its description. Every value passes `escapeHtml` once,
 * except the ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`.
 */

import type { Task }                 from '../../src/lib/tracker-model/@types/Task.ts';
import { HtmlEscapeUtil }            from '../../src/lib/utils/HtmlEscapeUtil.ts';
import { LIMITS }                    from '../../src/shared/constants/Limits.ts';
import type { KanbanCard }           from '../@types/KanbanCard.ts';
import { BoardRulesUtil }            from '../utils/BoardRulesUtil.ts';
import { MarkupUtil }                from '../utils/MarkupUtil.ts';
import { WorkItemMarkupUtil }        from '../utils/WorkItemMarkupUtil.ts';
import type { TicketTimelineLimits } from './@types/TicketTimeline.ts';
import { ticketTimelineMarkup }      from './TicketTimelineMarkup.ts';
import { DetailMarkupUtil }          from './utils/DetailMarkupUtil.ts';

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
  const reviewedMark       = ownRow !== null && BoardRulesUtil.cardCarriesReviewedMark(card) ? WorkItemMarkupUtil.reviewedMarkMarkup(ownRow, limits) : '';
  return [
    `<div class="ap-detail-head" ${MarkupUtil.attribute('data-state', card.state)}>`,
    `<span class="ap-detail-id">#${escapeHtml(ticket.id)}</span>`,
    `<h2 class="ap-detail-title">${escapeHtml(ticket.title)}</h2>`,
    `<span class="ap-pill">${escapeHtml(WorkItemMarkupUtil.pillLabelForRowState(card.state, ownRow?.reviewRound ?? LIMITS.FIRST_REPEAT_REVIEW_ROUND))}</span>`,
    reviewedMark,
    WorkItemMarkupUtil.priorityMarkMarkup(ticket),
    `<span class="ap-detail-type">${escapeHtml(ticket.type)}</span>`,
    '</div>',
  ].join('');
}

function plainFactMarkup(label: string, valueMarkup: string): string {
  return DetailMarkupUtil.factMarkup(label, `<span>${valueMarkup}</span>`);
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
    ? [DetailMarkupUtil.factMarkup(label, MarkupUtil.stampMarkup('span', stamp, todayCalendarDate, limits))]
    : []));
  if (ticket.reason !== undefined && ticket.reason !== '') facts.push(plainFactMarkup('reason', escapeHtml(ticket.reason)));
  if (ticket.hold !== undefined) facts.push(plainFactMarkup('held', escapeHtml(ticket.hold === '' ? HELD_WITHOUT_REASON_TEXT : ticket.hold)));
  if (card.waitingOn.length > 0) facts.push(plainFactMarkup('waiting on', WorkItemMarkupUtil.ticketLinksMarkup(card.waitingOn, 'kanban-card')));
  if (ticket.branch !== undefined && ticket.branch !== '') facts.push(plainFactMarkup('branch', escapeHtml(ticket.branch)));
  if (ticket.task !== null) facts.push(plainFactMarkup('task', WorkItemMarkupUtil.taskLinkMarkup(ticket.task)));
  return `<div class="ap-ticket-meta">${facts.join('')}</div>`;
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
    DetailMarkupUtil.sectionMarkup('Timeline', timeline),
    DetailMarkupUtil.sectionMarkup('Description', `<div class="ap-ticket-body md">${card.ticket.bodyHtml}</div>`),
  ].join('');
}
