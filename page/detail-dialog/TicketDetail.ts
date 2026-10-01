/**
 * The panel a Kanban card opens: the ticket's head, its facts (its epics and its group's integration first), its Timeline and its
 * description. Every value passes `escapeHtml` once, except the ticket's `bodyHtml`, already escaped by
 * `src/services/render/MarkdownRenderer.ts`.
 */

import { HtmlEscapeUtil }            from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { FIRST_REPEAT_REVIEW_ROUND } from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { PageTicket }           from '../../src/shared/@types/PagePayload.ts';
import type { KanbanCard }           from '../@types/KanbanCard.ts';
import { CLOSING_EVENT_WORD }        from '../constants/ClosingEventWords.ts';
import { EpicMarkup }                from '../epics/EpicMarkup.ts';
import { IntegrationMarkupUtil }     from '../utils/IntegrationMarkupUtil.ts';
import { MarkupUtil }                from '../utils/MarkupUtil.ts';
import { PauseTextUtil }             from '../utils/PauseTextUtil.ts';
import { TimeUtil }                  from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }        from '../utils/WorkItemMarkupUtil.ts';
import type { TicketTimelineLimits } from './@types/TicketTimeline.ts';
import { ticketTimelineMarkup }      from './TicketTimelineMarkup.ts';
import { DetailMarkupUtil }          from './utils/DetailMarkupUtil.ts';


const HELD_WITHOUT_REASON_TEXT = 'no reason given';

export interface TicketDetailInput {
  card:                 KanbanCard;
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  limits:               TicketTimelineLimits;
  /** Every ticket, which the integration fact reads the ticket's group from. */
  allTickets:           readonly PageTicket[];
}

function headMarkup(input: TicketDetailInput): string {
  const { card, limits } = input;
  const { ticket, ownRow } = card;
  const reviewedMark       = ownRow !== null && ownRow.deliveredRowCountsAsReviewed ? WorkItemMarkupUtil.reviewedMarkMarkup(ownRow, limits) : '';
  return [
    `<div class="ap-detail-head" ${MarkupUtil.attribute('data-state', card.state)}>`,
    `<span class="ap-detail-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`,
    `<h2 class="ap-detail-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}</h2>`,
    `<span class="ap-pill">${HtmlEscapeUtil.escapeHtml(WorkItemMarkupUtil.stateLabelOf(card.state, ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND))}</span>`,
    reviewedMark,
    WorkItemMarkupUtil.priorityMarkMarkup(ticket),
    `<span class="ap-detail-type">${HtmlEscapeUtil.escapeHtml(ticket.type)}</span>`,
    '</div>',
  ].join('');
}

function plainFactMarkup(label: string, valueMarkup: string): string {
  return DetailMarkupUtil.factMarkup(label, `<span>${valueMarkup}</span>`);
}

/** A paused build's since and duration, the full stamp on hover, then the row's note, which says why it waits. */
function pauseFactsMarkup(input: TicketDetailInput): string[] {
  const {
    card, limits, todayCalendarDate, nowEpochMilliseconds
  } = input;
  const pausedAt  = card.state === 'paused' ? PauseTextUtil.pausedStampOf(card.ownRow) : null;
  const pauseText = PauseTextUtil.pauseTextOf(card.ownRow, { nowEpochMilliseconds, todayCalendarDate, slices: limits });
  if (pausedAt === null || pauseText === null) {
    return [];
  }
  const fullStampTitle = MarkupUtil.attribute('title', TimeUtil.fullStampText(pausedAt, limits));
  const facts          = [DetailMarkupUtil.factMarkup('paused', `<span ${fullStampTitle}>${HtmlEscapeUtil.escapeHtml(pauseText)}</span>`)];
  const rowNote   = card.ownRow?.note ?? '';
  if (rowNote !== '') facts.push(plainFactMarkup('row note', HtmlEscapeUtil.escapeHtml(rowNote)));
  return facts;
}

function stampFactsMarkup(input: TicketDetailInput, stamps: Array<[label: string, stamp: string | null | undefined]>): string[] {
  return stamps.flatMap(([label, stamp]) => (typeof stamp === 'string' && stamp !== ''
    ? [DetailMarkupUtil.factMarkup(label, MarkupUtil.stampMarkup('span', stamp, input.todayCalendarDate, input.limits))]
    : []));
}

function factsMarkup(input: TicketDetailInput): string {
  const { card }           = input;
  const { ticket, ownRow } = card;
  const integration        = IntegrationMarkupUtil.integrationFactValueMarkup(ticket, input.allTickets, 'kanban-card');
  const facts = [
    card.epics.length === 0 ? '' : DetailMarkupUtil.factMarkup('epics', `<span class="ap-epic-chips">${EpicMarkup.epicChipsMarkup(card.epics)}</span>`),
    integration === '' ? '' : DetailMarkupUtil.factMarkup('integration', integration),
    ...stampFactsMarkup(input, [['filed', ticket.filed], ['started', ticket.started]]),
    ...pauseFactsMarkup(input),
    ...stampFactsMarkup(input, [
      ['finished', ticket.finished],
      ['reviewed', ownRow?.reviewed],
      [CLOSING_EVENT_WORD.delivered, ticket.delivered],
      [CLOSING_EVENT_WORD.abandoned, ticket.abandonedAt],
    ]),
  ];
  if (ticket.reason !== undefined && ticket.reason !== '') facts.push(plainFactMarkup('reason', HtmlEscapeUtil.escapeHtml(ticket.reason)));
  if (ticket.hold !== undefined) facts.push(plainFactMarkup('held', HtmlEscapeUtil.escapeHtml(ticket.hold === '' ? HELD_WITHOUT_REASON_TEXT : ticket.hold)));
  if (card.waitingOn.length > 0) facts.push(plainFactMarkup('waiting on', WorkItemMarkupUtil.ticketLinksMarkup(card.waitingOn, 'kanban-card')));
  if (ticket.branch !== undefined && ticket.branch !== '') facts.push(plainFactMarkup('branch', HtmlEscapeUtil.escapeHtml(ticket.branch)));
  if (ticket.task !== null) facts.push(plainFactMarkup('task', WorkItemMarkupUtil.taskLinkMarkup(ticket.task)));
  return `<div class="ap-ticket-meta">${facts.join('')}</div>`;
}

export function ticketDetailMarkup(input: TicketDetailInput): string {
  const { card } = input;
  const timeline = ticketTimelineMarkup({
    ticket:               card.ticket,
    ownRow:               card.ownRow,
    reviewBars:           card.reviewBars,
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
