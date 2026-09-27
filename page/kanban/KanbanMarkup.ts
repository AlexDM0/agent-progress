/** The Kanban tab's markup, shaped by the placeholder board in `resources/template.html`; it follows `page/kanban/utils/KanbanLaneUtil.ts`'s rules. */

import { HtmlLabelUtil }                   from '../../src/adapters/utils/HtmlLabelUtil.ts';
import type { DisplayState }               from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }       from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { TicketDefaultsUtil }              from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import { HtmlEscapeUtil }                  from '../../src/lib/utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }                  from '../../src/lib/utils/TokenCountUtil.ts';
import type { ClosedKanbanLane }           from '../@types/ClosedKanbanLane.ts';
import type { KanbanCard }                 from '../@types/KanbanCard.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }    from '../constants/CappedLanePaging.ts';
import { MarkupUtil }                      from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                  from '../utils/TemplateIdUtil.ts';
import { WorkItemMarkupUtil }              from '../utils/WorkItemMarkupUtil.ts';
import type { KanbanLane }                 from './@types/KanbanLane.ts';
import type { NoteFormat }                 from './KanbanLaneText.ts';
import { laneSubCountsOf, subStateNoteOf } from './KanbanLaneText.ts';
import { KANBAN_LANES }                    from './constants/KanbanBoardLayout.ts';
import { KanbanLaneUtil }                  from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                  from './utils/LanePagingUtil.ts';


const NO_ROW_TITLE = 'Low priority: it gets a row on the Progress chart once it is started';

interface LaneDesign {
  title:    string;
  dotState: DisplayState;
  /** The head's words before its counts. */
  leading:  string | null;
}

const LANE_DESIGN: Record<KanbanLane, LaneDesign> = {
  todo:      { title: 'To do', dotState: 'pending', leading: null },
  progress:  { title: 'In progress', dotState: 'in-progress', leading: null },
  review:    { title: 'Review', dotState: 'reviewing', leading: null },
  merge:     { title: 'Awaiting merge', dotState: 'reviewed', leading: 'by priority' },
  done:      { title: 'Done', dotState: 'delivered', leading: 'newest first' },
  abandoned: { title: 'Abandoned', dotState: 'abandoned', leading: 'newest first' },
};

/** Under Hide the closed lanes hold only the last day, and their empty text says so. */
const EMPTY_LANE_TEXT: Record<KanbanLane, string> = {
  todo:      'Nothing waiting to start.',
  progress:  'Nothing being built.',
  review:    'Nothing in review.',
  merge:     'Nothing awaiting merge.',
  done:      'Nothing delivered in the last day.',
  abandoned: 'Nothing abandoned in the last day.',
};

const EMPTY_CLOSED_LANE_TEXT_UNDER_SHOW_ALL: Record<ClosedKanbanLane, string> = {
  done:      'Nothing delivered yet.',
  abandoned: 'Nothing abandoned.',
};

export interface KanbanBoardInput extends NoteFormat {
  /** The cards of the tickets the Tickets tab shows. */
  cards:                  readonly KanbanCard[];
  showsAllWork:           boolean;
  shownCountByClosedLane: Readonly<Record<ClosedKanbanLane, number>>;
  abandonedLaneIsOpen:    boolean;
}

function pillLabelOf(card: KanbanCard): string {
  return WorkItemMarkupUtil.pillLabelForDisplayState(card.state, card.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
}

function marksMarkup(card: KanbanCard, lane: KanbanLane): string {
  const { hold } = card.ticket;
  const marks    = [
    WorkItemMarkupUtil.waitingOnMarkup(card.waitingOn, 'kanban-card'),
    hold === undefined ? '' : `<span class="ap-kanban-held" ${MarkupUtil.attribute('title', hold === '' ? 'Held' : `Held: ${hold}`)}>held</span>`,
    lane === 'todo' && card.ownRow === null ? `<span class="ap-kanban-no-row" ${MarkupUtil.attribute('title', NO_ROW_TITLE)}>no row yet</span>` : '',
  ].join('');
  return marks === '' ? '' : `<div class="ap-kanban-marks">${marks}</div>`;
}

function stateMarkup(card: KanbanCard, lane: KanbanLane, format: NoteFormat): string {
  const pill         = KanbanLaneUtil.laneMixesStates(lane) ? `<span class="ap-pill">${HtmlEscapeUtil.escapeHtml(pillLabelOf(card))}</span>` : '';
  const reviewedMark = lane === 'done' && card.ownRow !== null && card.ownRow.deliveredRowCountsAsReviewed
    ? `${WorkItemMarkupUtil.reviewedMarkMarkup(card.ownRow, format.slices)}<span>reviewed</span>`
    : '';
  return `<div class="ap-kanban-state">${pill}${reviewedMark}</div>`;
}

export function kanbanCardMarkup(card: KanbanCard, lane: KanbanLane, format: NoteFormat): string {
  const { ticket, ownRow } = card;
  const label              = `#${ticket.id} ${ticket.title}, ${pillLabelOf(card)}, ${HtmlLabelUtil.priorityLabelOf(TicketDefaultsUtil.ticketPriorityOf(ticket))} priority`;
  const identities         = [
    MarkupUtil.attribute('id', TemplateIdUtil.kanbanCardElementIdOf(ticket.id)),
    MarkupUtil.attribute('data-ticket-id', ticket.id),
    MarkupUtil.attribute('data-state', card.state),
  ].join(' ');
  const tokens             = ownRow === null || ownRow.tokens === null
    ? ''
    : `<span class="ap-tokens">${HtmlEscapeUtil.escapeHtml(TokenCountUtil.formatTokenCount(ownRow.tokens))} tokens</span>`;
  const note               = subStateNoteOf(card, format);
  return [
    `<article class="ap-kanban-card" ${identities}${ownRow === null ? ' data-row="none"' : ''} tabindex="0" ${MarkupUtil.attribute('aria-label', label)}>`,
    `<div class="ap-kanban-card-head"><span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>${WorkItemMarkupUtil.priorityMarkMarkup(ticket)}`,
    `<span class="ap-detail-type">${HtmlEscapeUtil.escapeHtml(HtmlLabelUtil.ticketTypeLabelOf(ticket.type))}</span></div>`,
    tokens,
    `<p class="ap-kanban-title" ${MarkupUtil.attribute('title', ticket.title)}>${HtmlEscapeUtil.escapeHtml(ticket.title)}</p>`,
    marksMarkup(card, lane),
    note === null ? '' : `<p class="ap-kanban-note">${HtmlEscapeUtil.escapeHtml(note)}</p>`,
    stateMarkup(card, lane, format),
    WorkItemMarkupUtil.latestMilestoneMarkup(ticket, format.slices, format.todayCalendarDate, 'ap-kanban-stamp'),
    '</article>',
  ].join('');
}

function laneSubMarkup(lane: KanbanLane, members: readonly KanbanCard[]): string {
  const { leading } = LANE_DESIGN[lane];
  const counts      = laneSubCountsOf(lane, members).map((entry) => {
    const dot  = entry.dotState === null ? '' : `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', entry.dotState)}></span>`;
    const mark = entry.reviewedMark ? '<span class="ap-reviewed-mark" data-state="reviewed" aria-hidden="true">✓</span>' : '';
    return `${dot}${mark}${entry.count} ${HtmlEscapeUtil.escapeHtml(entry.label)}`;
  });
  const parts = [...leading === null ? [] : [HtmlEscapeUtil.escapeHtml(leading)], ...counts];
  return parts.length === 0 ? '' : `<span class="ap-lane-sub">${parts.join(' · ')}</span>`;
}

function laneCardsMarkup(lane: KanbanLane, members: readonly KanbanCard[], shown: readonly KanbanCard[], input: KanbanBoardInput): string {
  if (shown.length === 0) {
    const emptyText = KanbanLaneUtil.laneIsClosed(lane) && input.showsAllWork ? EMPTY_CLOSED_LANE_TEXT_UNDER_SHOW_ALL[lane] : EMPTY_LANE_TEXT[lane];
    return `<div class="ap-empty">${HtmlEscapeUtil.escapeHtml(emptyText)}</div>`;
  }
  const dividesByPriority = KanbanLaneUtil.laneIsDividedByPriority(lane, members);
  return shown.map((card, index) => {
    const priority    = TicketDefaultsUtil.ticketPriorityOf(card.ticket);
    const startsGroup = dividesByPriority && (index === 0 || TicketDefaultsUtil.ticketPriorityOf(shown[index - 1]?.ticket ?? card.ticket) !== priority);
    const groupSize   = shown.filter((other) => TicketDefaultsUtil.ticketPriorityOf(other.ticket) === priority).length;
    const groupTitle  = HtmlLabelUtil.priorityGroupTitleOf(priority);
    const divider     = startsGroup
      ? `<div class="ap-lane-group" ${MarkupUtil.attribute('data-priority', priority)}>${groupTitle} <span class="ap-lane-group-count">${groupSize}</span></div>`
      : '';
    return `${divider}${kanbanCardMarkup(card, lane, input)}`;
  }).join('');
}

export function cappedLaneFooterMarkup(lane: ClosedKanbanLane, shownCount: number, laneCount: number): string {
  if (laneCount <= CAPPED_LANE_FIRST_PAGE_CARDS) {
    return '';
  }
  const pageSize = LanePagingUtil.nextPageSizeFor(shownCount, laneCount);
  const buttons  = [
    pageSize > 0 ? `<button type="button" ${MarkupUtil.attribute('data-lane-more', lane)}>Show ${pageSize} more</button>` : '',
    shownCount > CAPPED_LANE_FIRST_PAGE_CARDS ? `<button type="button" ${MarkupUtil.attribute('data-lane-reset', lane)}>Latest ${CAPPED_LANE_FIRST_PAGE_CARDS}</button>` : '',
  ].join('');
  return `<div class="ap-lane-more"><span>${shownCount} of ${laneCount} shown</span><div class="ap-seg">${buttons}</div></div>`;
}

function laneHeadMarkup(lane: KanbanLane, members: readonly KanbanCard[], laneIsCollapsed: boolean): string {
  const design    = LANE_DESIGN[lane];
  const headInner = [
    `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', design.dotState)}></span>`,
    `<span class="ap-card-title">${HtmlEscapeUtil.escapeHtml(design.title)}</span>`,
    `<span class="ap-lane-count">${members.length}</span>`,
  ].join('');
  const sub = laneSubMarkup(lane, members);
  if (lane !== 'abandoned') {
    return `<div class="ap-card-head">${headInner}${sub}</div>`;
  }
  const toggle = [
    `<button type="button" class="ap-lane-toggle" aria-expanded="${String(!laneIsCollapsed)}" aria-controls="ap-lane-abandoned-cards"`,
    ` ${MarkupUtil.attribute('title', `${laneIsCollapsed ? 'Show' : 'Collapse'} the abandoned tickets`)}>${headInner}</button>`,
  ].join('');
  return `<div class="ap-card-head">${toggle}${sub}</div>`;
}

export function kanbanLaneMarkup(lane: KanbanLane, input: KanbanBoardInput): string {
  const members         = KanbanLaneUtil.cardsInLane(input.cards, lane);
  const shownCount      = KanbanLaneUtil.laneIsClosed(lane) ? LanePagingUtil.cappedLaneShownCount(input.shownCountByClosedLane[lane], members.length) : members.length;
  const shown           = members.slice(0, shownCount);
  const footer          = KanbanLaneUtil.laneIsClosed(lane) ? cappedLaneFooterMarkup(lane, shownCount, members.length) : '';
  const laneIsCollapsed = lane === 'abandoned' && !input.abandonedLaneIsOpen;
  const design          = LANE_DESIGN[lane];
  return [
    `<section class="ap-card ap-lane" ${MarkupUtil.attribute('data-lane', lane)}${laneIsCollapsed ? ' data-collapsed=""' : ''}`,
    ` ${MarkupUtil.attribute('aria-label', design.title)}>`,
    laneHeadMarkup(lane, members, laneIsCollapsed),
    `<div class="ap-lane-cards" ${MarkupUtil.attribute('id', `ap-lane-${lane}-cards`)}>${laneCardsMarkup(lane, members, shown, input)}</div>`,
    footer,
    '</section>',
  ].join('');
}

export function kanbanBoardMarkup(input: KanbanBoardInput): string {
  return KANBAN_LANES.map((lane) => kanbanLaneMarkup(lane, input)).join('');
}
