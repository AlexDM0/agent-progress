/** The Kanban tab's markup, shaped by the placeholder board in `resources/template.html`; it follows `page/kanban/utils/KanbanLaneUtil.ts`'s rules. */

import { HtmlLabelUtil }                    from '../../src/adapters/utils/HtmlLabelUtil.ts';
import { HtmlEscapeUtil }                   from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                   from '../../src/lib/token-count/TokenCountUtil.ts';
import type { DisplayState }                from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }        from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { TicketDefaultsUtil }               from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { DependencyGraph }             from '../@types/DependencyGraph.ts';
import type { KanbanCard }                  from '../@types/KanbanCard.ts';
import type { FinishedWorkChoice }          from '../@types/ViewerChoices.ts';
import type { TodoOrderChoice }             from '../@types/ViewerChoices.ts';
import { CLOSING_EVENT_WORD }               from '../constants/ClosingEventWords.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }    from '../constants/StateLabels.ts';
import { CARD_EPIC_CHIP_LIMIT, EpicMarkup } from '../epics/EpicMarkup.ts';
import { FinishedWorkUtil }                 from '../utils/FinishedWorkUtil.ts';
import { MarkupUtil }                       from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                   from '../utils/TemplateIdUtil.ts';
import { WorkItemMarkupUtil }               from '../utils/WorkItemMarkupUtil.ts';
import type { KanbanLane }                  from './@types/KanbanLane.ts';
import type { NoteFormat }                  from './KanbanLaneText.ts';
import { laneSubCountsOf, subStateNoteOf }  from './KanbanLaneText.ts';
import type { ClosedKanbanLane }            from './constants/KanbanBoardLayout.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }     from './constants/KanbanBoardLayout.ts';
import { KANBAN_LANES }                     from './constants/KanbanBoardLayout.ts';
import { KanbanLaneUtil }                   from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                   from './utils/LanePagingUtil.ts';


const NO_ROW_TITLE = 'Low priority: it gets a row on the Progress chart once it is started';

/** From this many tickets waiting on a card, its `↦ N` reads in full ink. */
const HEAVY_HELD_COUNT = 5;

const READY_WAVE_TITLE = 'Ready now';

interface LaneDesign {
  title:    string;
  dotState: DisplayState;
  /** The head's words before its counts. */
  leading:  string | null;
}

/** A lane holding one state is named by that state's label; the two lanes that mix states keep a group name. */
const LANE_DESIGN: Record<KanbanLane, LaneDesign> = {
  todo:      { title: STATE_LABEL_FOR_DISPLAY_STATE.pending, dotState: 'pending', leading: null },
  progress:  { title: 'In progress', dotState: 'in-progress', leading: null },
  review:    { title: 'Review', dotState: 'reviewing', leading: null },
  merge:     { title: STATE_LABEL_FOR_DISPLAY_STATE.reviewed, dotState: 'reviewed', leading: 'by priority' },
  done:      { title: STATE_LABEL_FOR_DISPLAY_STATE.delivered, dotState: 'delivered', leading: 'newest first' },
  abandoned: { title: STATE_LABEL_FOR_DISPLAY_STATE.abandoned, dotState: 'abandoned', leading: 'newest first' },
};

const EMPTY_LANE_TEXT: Record<Exclude<KanbanLane, ClosedKanbanLane>, string> = {
  todo:     'Nothing waiting to start.',
  progress: 'Nothing being built.',
  review:   'Nothing in review.',
  merge:    'Nothing awaiting merge.',
};

const CLOSED_LANE_VERB: Record<ClosedKanbanLane, string> = {
  done:      CLOSING_EVENT_WORD.delivered,
  abandoned: CLOSING_EVENT_WORD.abandoned,
};

const EMPTY_CLOSED_LANE_TEXT_UNDER_ALL: Record<ClosedKanbanLane, string> = {
  done:      'Nothing done yet.',
  abandoned: 'Nothing abandoned.',
};

/** The closed lanes hold what the finished-work switch lets through, and their empty text says how far back that reaches. */
function emptyClosedLaneText(lane: ClosedKanbanLane, finishedWork: FinishedWorkChoice): string {
  return finishedWork === 'all' ? EMPTY_CLOSED_LANE_TEXT_UNDER_ALL[lane] : `Nothing ${CLOSED_LANE_VERB[lane]} ${FinishedWorkUtil.windowPhraseOf(finishedWork)}.`;
}

export interface KanbanBoardInput extends NoteFormat {
  /** The cards of the tickets the Tickets tab shows. */
  cards:                   readonly KanbanCard[];
  finishedWork:            FinishedWorkChoice;
  /** The lane's tickets the finished-work switch leaves out. */
  hiddenCountByClosedLane: Readonly<Record<ClosedKanbanLane, number>>;
  shownCountByClosedLane:  Readonly<Record<ClosedKanbanLane, number>>;
  abandonedLaneIsOpen:     boolean;
  todoOrder:               TodoOrderChoice;
  /** Spans every ticket, finished ones included, so neither filter reshapes the waves. */
  dependencyGraph:         DependencyGraph;
}

export interface KanbanCardFormat extends NoteFormat {
  dependencyGraph:     DependencyGraph;
  /** The tickets some card on the board depends on directly: only their cards can show "needed first". */
  dependedOnTicketIds: ReadonlySet<string>;
}

export function kanbanCardFormatOf(input: KanbanBoardInput): KanbanCardFormat {
  return {
    nowEpochMilliseconds: input.nowEpochMilliseconds,
    todayCalendarDate:    input.todayCalendarDate,
    slices:               input.slices,
    dependencyGraph:      input.dependencyGraph,
    dependedOnTicketIds:  new Set(input.cards.flatMap((card) => card.ticket.dependsOn ?? [])),
  };
}

function pillLabelOf(card: KanbanCard): string {
  return WorkItemMarkupUtil.stateLabelOf(card.state, card.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
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

/**
 * The "needed first" slot, on every card another card depends on, so hovering the dependent only fades it in; then `↦ N` for an
 * unfinished ticket others wait on. A board without dependencies gets neither, so its cards stay as they were.
 */
function dependencyHeadMarkup(card: KanbanCard, lane: KanbanLane, format: KanbanCardFormat): string {
  const ticketId    = card.ticket.id;
  const neededFirst = format.dependedOnTicketIds.has(ticketId) ? '<span class="ap-kanban-needed-first" aria-hidden="true">needed first</span>' : '';
  const heldCount   = KanbanLaneUtil.laneIsClosed(lane) ? 0 : format.dependencyGraph.heldOfTicket.get(ticketId)?.size ?? 0;
  const heldTitle   = `${heldCount} ${heldCount === 1 ? 'ticket waits' : 'tickets wait'} on this one, directly or further down the chain`;
  const held        = heldCount === 0
    ? ''
    : `<span class="ap-kanban-held-count"${heldCount >= HEAVY_HELD_COUNT ? ' data-heavy=""' : ''} ${MarkupUtil.attribute('title', heldTitle)}>↦ ${heldCount}</span>`;
  return `${neededFirst}${held}`;
}

export function kanbanCardMarkup(card: KanbanCard, lane: KanbanLane, format: KanbanCardFormat): string {
  const { ticket, ownRow } = card;
  const label              = `#${ticket.id} ${ticket.title}, ${pillLabelOf(card)}, ${TicketDefaultsUtil.ticketPriorityOf(ticket)} priority`;
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
    `<span class="ap-detail-type">${HtmlEscapeUtil.escapeHtml(ticket.type)}</span>${dependencyHeadMarkup(card, lane, format)}</div>`,
    tokens,
    `<p class="ap-kanban-title" ${MarkupUtil.attribute('title', ticket.title)}>${HtmlEscapeUtil.escapeHtml(ticket.title)}</p>`,
    card.epics.length === 0 ? '' : `<div class="ap-epic-chips">${EpicMarkup.epicChipsMarkup(card.epics, CARD_EPIC_CHIP_LIMIT)}</div>`,
    marksMarkup(card, lane),
    note === null ? '' : `<p class="ap-kanban-note">${HtmlEscapeUtil.escapeHtml(note)}</p>`,
    stateMarkup(card, lane, format),
    WorkItemMarkupUtil.latestMilestoneMarkup(ticket, format.slices, format.todayCalendarDate, 'ap-kanban-stamp'),
    '</article>',
  ].join('');
}

function todoIsByWave(lane: KanbanLane, input: KanbanBoardInput): boolean {
  return lane === 'todo' && input.todoOrder === 'by-wave';
}

function laneSubMarkup(lane: KanbanLane, members: readonly KanbanCard[], input: KanbanBoardInput): string {
  if (todoIsByWave(lane, input)) {
    const readyCount = members.filter((card) => input.dependencyGraph.readyTicketIds.includes(card.ticket.id)).length;
    return `<span class="ap-lane-sub">${readyCount} ready · ${members.length - readyCount} waiting</span>`;
  }
  const { leading } = LANE_DESIGN[lane];
  const counts      = laneSubCountsOf(lane, members).map((entry) => {
    const dot  = entry.dotState === null ? '' : `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', entry.dotState)}></span>`;
    const mark = entry.reviewedMark ? '<span class="ap-reviewed-mark" data-state="reviewed" aria-hidden="true">✓</span>' : '';
    return `${dot}${mark}${entry.count} ${HtmlEscapeUtil.escapeHtml(entry.label)}`;
  });
  const parts = [...leading === null ? [] : [HtmlEscapeUtil.escapeHtml(leading)], ...counts];
  return parts.length === 0 ? '' : `<span class="ap-lane-sub">${parts.join(' · ')}</span>`;
}

/**
 * To do by wave: one group per wave holding To do cards, its head naming the wave and how wide all of it is, a one-ticket wave tinted as
 * the bottleneck; within it the wave's own order, pace path first, then most held. A card the graph places in no wave closes the lane.
 */
function todoWaveGroupsMarkup(members: readonly KanbanCard[], format: KanbanCardFormat): string {
  const cardById = new Map(members.map((card) => [card.ticket.id, card]));
  const placed   = new Set<string>();
  const groups   = format.dependencyGraph.waves.map((wave) => {
    const cards = wave.ticketIds.flatMap((ticketId) => cardById.get(ticketId) ?? []);
    if (cards.length === 0) {
      return '';
    }
    cards.forEach((card) => placed.add(card.ticket.id));
    const title = wave.index === 0 ? READY_WAVE_TITLE : wave.label;
    const note  = wave.isNarrow ? 'one at a time' : `${wave.ticketIds.length} side by side`;
    return [
      `<div class="ap-lane-wave" ${MarkupUtil.attribute('data-wave', String(wave.index))}${wave.isNarrow ? ' data-narrow=""' : ''}>`,
      `<div class="ap-lane-group">${HtmlEscapeUtil.escapeHtml(title)} <span class="ap-lane-group-note">${note}</span></div>`,
      cards.map((card) => kanbanCardMarkup(card, 'todo', format)).join(''),
      '</div>',
    ].join('');
  }).join('');
  const unplaced = members.filter((card) => !placed.has(card.ticket.id)).map((card) => kanbanCardMarkup(card, 'todo', format)).join('');
  return `${groups}${unplaced}`;
}

function laneCardsMarkup(lane: KanbanLane, members: readonly KanbanCard[], shown: readonly KanbanCard[], input: KanbanBoardInput): string {
  if (shown.length === 0) {
    const emptyText = KanbanLaneUtil.laneIsClosed(lane) ? emptyClosedLaneText(lane, input.finishedWork) : EMPTY_LANE_TEXT[lane];
    return `<div class="ap-empty">${HtmlEscapeUtil.escapeHtml(emptyText)}</div>`;
  }
  const format = kanbanCardFormatOf(input);
  if (todoIsByWave(lane, input)) {
    return todoWaveGroupsMarkup(shown, format);
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
    return `${divider}${kanbanCardMarkup(card, lane, format)}`;
  }).join('');
}

function cappedLanePagingMarkup(lane: ClosedKanbanLane, shownCount: number, laneCount: number): string {
  if (laneCount <= CAPPED_LANE_FIRST_PAGE_CARDS) {
    return '';
  }
  const pageSize = LanePagingUtil.nextPageSizeFor(shownCount, laneCount);
  const buttons  = [
    pageSize > 0 ? `<button type="button" ${MarkupUtil.attribute('data-lane-more', lane)}>Show ${pageSize} more</button>` : '',
    shownCount > CAPPED_LANE_FIRST_PAGE_CARDS ? `<button type="button" ${MarkupUtil.attribute('data-lane-reset', lane)}>Latest ${CAPPED_LANE_FIRST_PAGE_CARDS}</button>` : '',
  ].join('');
  return `<span>${shownCount} of ${laneCount} shown</span><div class="ap-seg">${buttons}</div>`;
}

/** The paging while the lane holds more than a page, then what the finished-work switch leaves out of it, with a way to show it all. */
export function cappedLaneFooterMarkup(lane: ClosedKanbanLane, shownCount: number, laneCount: number, hiddenCount = 0): string {
  const hiddenLine = hiddenCount > 0
    ? `<div class="ap-lane-hidden-line"><span>${hiddenCount} earlier hidden</span><button type="button" class="ap-link-button" data-show-all-finished>show all</button></div>`
    : '';
  const contents = `${cappedLanePagingMarkup(lane, shownCount, laneCount)}${hiddenLine}`;
  return contents === '' ? '' : `<div class="ap-lane-more">${contents}</div>`;
}

function laneHeadMarkup(lane: KanbanLane, members: readonly KanbanCard[], laneIsCollapsed: boolean, input: KanbanBoardInput): string {
  const design    = LANE_DESIGN[lane];
  const headInner = [
    `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', design.dotState)}></span>`,
    `<span class="ap-card-title">${HtmlEscapeUtil.escapeHtml(design.title)}</span>`,
    `<span class="ap-lane-count">${members.length}</span>`,
  ].join('');
  const sub = laneSubMarkup(lane, members, input);
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
  const footer          = KanbanLaneUtil.laneIsClosed(lane) ? cappedLaneFooterMarkup(lane, shownCount, members.length, input.hiddenCountByClosedLane[lane]) : '';
  const laneIsCollapsed = lane === 'abandoned' && !input.abandonedLaneIsOpen;
  const design          = LANE_DESIGN[lane];
  return [
    `<section class="ap-card ap-lane" ${MarkupUtil.attribute('data-lane', lane)}${laneIsCollapsed ? ' data-collapsed=""' : ''}`,
    ` ${MarkupUtil.attribute('aria-label', design.title)}>`,
    laneHeadMarkup(lane, members, laneIsCollapsed, input),
    `<div class="ap-lane-cards" ${MarkupUtil.attribute('id', `ap-lane-${lane}-cards`)}>${laneCardsMarkup(lane, members, shown, input)}</div>`,
    footer,
    '</section>',
  ].join('');
}

export function kanbanBoardMarkup(input: KanbanBoardInput): string {
  return KANBAN_LANES.map((lane) => kanbanLaneMarkup(lane, input)).join('');
}
