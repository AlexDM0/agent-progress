/** The Kanban tab's markup, shaped by the placeholder board in `lib/render/page/template.html`; the rules it follows are `KanbanBoard.ts`'s. */

import { FIRST_REPEAT_REVIEW_ROUND } from '../../constants/Limits.ts';
import { ticketPriorityOf }          from '../../constants/Statuses.ts';
import type { TicketPriority }       from '../../constants/Types.ts';
import { HtmlEscapeUtil }            from '../../utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }            from '../../utils/TokenCountUtil.ts';
import type {
  ClosedKanbanLane,
  KanbanCard,
  KanbanLane,
  NoteFormat,
} from './KanbanBoard.ts';
import {
  CAPPED_LANE_FIRST_PAGE,
  cappedLaneShownCount,
  cardCarriesReviewedMark,
  cardsInLane,
  KANBAN_LANES,
  laneIsClosed,
  laneIsDividedByPriority,
  laneMixesStates,
  laneSubCountsOf,
  nextPageSizeFor,
  subStateNoteOf,
} from './KanbanBoard.ts';
import type { RowState } from './PageMarkup.ts';
import {
  attribute,
  latestMilestoneMarkup,
  pillLabelForRowState,
  priorityMarkMarkup,
  reviewedMarkMarkup,
  waitingOnMarkup,
} from './PageMarkup.ts';

const { escapeHtml }       = HtmlEscapeUtil;
const { formatTokenCount } = TokenCountUtil;

const NO_ROW_TITLE = 'Low priority: it gets a row on the Progress chart once it is started';

interface LaneDesign {
  title:    string;
  dotState: RowState;
  /** The head's words before its counts. */
  leading:  string | null;
}

const LANE_DESIGN: Record<KanbanLane, LaneDesign> = {
  todo:      { title: 'To do', dotState: 'pending', leading: null },
  progress:  { title: 'In progress', dotState: 'running', leading: null },
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

const PRIORITY_TITLE: Record<TicketPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' };

export interface KanbanBoardInput extends NoteFormat {
  /** The cards of the tickets the Tickets tab shows; rows are looked up in the whole progress file, `tasks`. */
  cards:                  readonly KanbanCard[];
  showsAllWork:           boolean;
  shownCountByClosedLane: Readonly<Record<ClosedKanbanLane, number>>;
  abandonedLaneIsOpen:    boolean;
}

function pillLabelOf(card: KanbanCard): string {
  return pillLabelForRowState(card.state, card.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
}

function marksMarkup(card: KanbanCard, lane: KanbanLane): string {
  const { hold } = card.ticket;
  const marks    = [
    waitingOnMarkup(card.waitingOn, 'kanban-card'),
    hold === undefined ? '' : `<span class="ap-kanban-held" ${attribute('title', hold === '' ? 'Held' : `Held: ${hold}`)}>held</span>`,
    lane === 'todo' && card.ownRow === null ? `<span class="ap-kanban-no-row" ${attribute('title', NO_ROW_TITLE)}>no row yet</span>` : '',
  ].join('');
  return marks === '' ? '' : `<div class="ap-kanban-marks">${marks}</div>`;
}

function stateMarkup(card: KanbanCard, lane: KanbanLane, format: NoteFormat): string {
  const pill         = laneMixesStates(lane) ? `<span class="ap-pill">${escapeHtml(pillLabelOf(card))}</span>` : '';
  const reviewedMark = lane === 'done' && card.ownRow !== null && cardCarriesReviewedMark(card)
    ? `${reviewedMarkMarkup(card.ownRow, format.slices)}<span>reviewed</span>`
    : '';
  return `<div class="ap-kanban-state">${pill}${reviewedMark}</div>`;
}

export function kanbanCardMarkup(card: KanbanCard, lane: KanbanLane, format: NoteFormat): string {
  const { ticket, ownRow } = card;
  const label              = `#${ticket.id} ${ticket.title}, ${pillLabelOf(card)}, ${ticketPriorityOf(ticket)} priority`;
  const identities         = `${attribute('id', `ap-kanban-${ticket.id}`)} ${attribute('data-ticket-id', ticket.id)} ${attribute('data-state', card.state)}`;
  const tokens             = ownRow === null || ownRow.tokens === null ? '' : `<span class="ap-tokens">${escapeHtml(formatTokenCount(ownRow.tokens))} tokens</span>`;
  const note               = subStateNoteOf(card, format);
  return [
    `<article class="ap-kanban-card" ${identities}${ownRow === null ? ' data-row="none"' : ''} tabindex="0" ${attribute('aria-label', label)}>`,
    `<div class="ap-kanban-card-head"><span class="ap-ticket-id">#${escapeHtml(ticket.id)}</span>${priorityMarkMarkup(ticket)}`,
    `<span class="ap-detail-type">${escapeHtml(ticket.type)}</span></div>`,
    tokens,
    `<p class="ap-kanban-title" ${attribute('title', ticket.title)}>${escapeHtml(ticket.title)}</p>`,
    marksMarkup(card, lane),
    note === null ? '' : `<p class="ap-kanban-note">${escapeHtml(note)}</p>`,
    stateMarkup(card, lane, format),
    latestMilestoneMarkup(ticket, format.slices, format.todayCalendarDate, 'ap-kanban-stamp'),
    '</article>',
  ].join('');
}

function laneSubMarkup(lane: KanbanLane, members: readonly KanbanCard[]): string {
  const { leading } = LANE_DESIGN[lane];
  const counts      = laneSubCountsOf(lane, members).map((entry) => {
    const dot  = entry.dotState === null ? '' : `<span class="ap-lane-dot" ${attribute('data-state', entry.dotState)}></span>`;
    const mark = entry.reviewedMark ? '<span class="ap-reviewed-mark" data-state="reviewed" aria-hidden="true">✓</span>' : '';
    return `${dot}${mark}${entry.count} ${escapeHtml(entry.label)}`;
  });
  const parts = [...leading === null ? [] : [escapeHtml(leading)], ...counts];
  return parts.length === 0 ? '' : `<span class="ap-lane-sub">${parts.join(' · ')}</span>`;
}

function laneCardsMarkup(lane: KanbanLane, members: readonly KanbanCard[], shown: readonly KanbanCard[], input: KanbanBoardInput): string {
  if (shown.length === 0) {
    const emptyText = laneIsClosed(lane) && input.showsAllWork ? EMPTY_CLOSED_LANE_TEXT_UNDER_SHOW_ALL[lane] : EMPTY_LANE_TEXT[lane];
    return `<div class="ap-empty">${escapeHtml(emptyText)}</div>`;
  }
  const dividesByPriority = laneIsDividedByPriority(lane, members);
  return shown.map((card, index) => {
    const priority    = ticketPriorityOf(card.ticket);
    const startsGroup = dividesByPriority && (index === 0 || ticketPriorityOf(shown[index - 1]?.ticket ?? card.ticket) !== priority);
    const groupSize   = shown.filter((other) => ticketPriorityOf(other.ticket) === priority).length;
    const divider     = startsGroup
      ? `<div class="ap-lane-group" ${attribute('data-priority', priority)}>${PRIORITY_TITLE[priority]} <span class="ap-lane-group-count">${groupSize}</span></div>`
      : '';
    return `${divider}${kanbanCardMarkup(card, lane, input)}`;
  }).join('');
}

export function cappedLaneFooterMarkup(lane: ClosedKanbanLane, shownCount: number, laneCount: number): string {
  if (laneCount <= CAPPED_LANE_FIRST_PAGE) {
    return '';
  }
  const pageSize = nextPageSizeFor(shownCount, laneCount);
  const buttons  = [
    pageSize > 0 ? `<button type="button" ${attribute('data-lane-more', lane)}>Show ${pageSize} more</button>` : '',
    shownCount > CAPPED_LANE_FIRST_PAGE ? `<button type="button" ${attribute('data-lane-reset', lane)}>Latest ${CAPPED_LANE_FIRST_PAGE}</button>` : '',
  ].join('');
  return `<div class="ap-lane-more"><span>${shownCount} of ${laneCount} shown</span><div class="ap-seg">${buttons}</div></div>`;
}

function laneHeadMarkup(lane: KanbanLane, members: readonly KanbanCard[], laneIsCollapsed: boolean): string {
  const design    = LANE_DESIGN[lane];
  const headInner = [
    `<span class="ap-lane-dot" ${attribute('data-state', design.dotState)}></span>`,
    `<span class="ap-card-title">${escapeHtml(design.title)}</span>`,
    `<span class="ap-lane-count">${members.length}</span>`,
  ].join('');
  const sub = laneSubMarkup(lane, members);
  if (lane !== 'abandoned') {
    return `<div class="ap-card-head">${headInner}${sub}</div>`;
  }
  const toggle = [
    `<button type="button" class="ap-lane-toggle" aria-expanded="${String(!laneIsCollapsed)}" aria-controls="ap-lane-abandoned-cards"`,
    ` ${attribute('title', `${laneIsCollapsed ? 'Show' : 'Collapse'} the abandoned tickets`)}>${headInner}</button>`,
  ].join('');
  return `<div class="ap-card-head">${toggle}${sub}</div>`;
}

export function kanbanLaneMarkup(lane: KanbanLane, input: KanbanBoardInput): string {
  const members         = cardsInLane(input.cards, lane);
  const shownCount      = laneIsClosed(lane) ? cappedLaneShownCount(input.shownCountByClosedLane[lane], members.length) : members.length;
  const shown           = members.slice(0, shownCount);
  const footer          = laneIsClosed(lane) ? cappedLaneFooterMarkup(lane, shownCount, members.length) : '';
  const laneIsCollapsed = lane === 'abandoned' && !input.abandonedLaneIsOpen;
  const design          = LANE_DESIGN[lane];
  return [
    `<section class="ap-card ap-lane" ${attribute('data-lane', lane)}${laneIsCollapsed ? ' data-collapsed=""' : ''} ${attribute('aria-label', design.title)}>`,
    laneHeadMarkup(lane, members, laneIsCollapsed),
    `<div class="ap-lane-cards" ${attribute('id', `ap-lane-${lane}-cards`)}>${laneCardsMarkup(lane, members, shown, input)}</div>`,
    footer,
    '</section>',
  ].join('');
}

export function kanbanBoardMarkup(input: KanbanBoardInput): string {
  return KANBAN_LANES.map((lane) => kanbanLaneMarkup(lane, input)).join('');
}
