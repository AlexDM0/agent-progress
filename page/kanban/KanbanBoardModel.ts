/** The tracker page's Kanban as lane and card models, following `page/kanban/utils/KanbanLaneUtil.ts`'s rules; the renderers draw them. */

import { HtmlLabelUtil }                   from '../../src/adapters/utils/HtmlLabelUtil.ts';
import type { DisplayState }               from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }       from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { TicketDefaultsUtil }              from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { KanbanCard }                 from '../@types/KanbanCard.ts';
import type { FinishedWorkChoice }         from '../@types/ViewerChoices.ts';
import { CLOSING_EVENT_WORD }              from '../constants/ClosingEventWords.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }   from '../constants/StateLabels.ts';
import { EPIC_MARK_VOCABULARY }            from '../epics/EpicMarkVocabulary.ts';
import { FinishedWorkUtil }                from '../utils/FinishedWorkUtil.ts';
import { TemplateIdUtil }                  from '../utils/TemplateIdUtil.ts';
import { WorkItemMarkupUtil }              from '../utils/WorkItemMarkupUtil.ts';
import type { KanbanBoardInput }           from './@types/KanbanBoardInput.ts';
import type { KanbanCardFormat }           from './@types/KanbanBoardInput.ts';
import type { KanbanLane }                 from './@types/KanbanLane.ts';
import type { LaneBody }                   from './@types/LaneBoard.ts';
import type { LaneCardGroup }              from './@types/LaneBoard.ts';
import type { LaneCardHeldCount }          from './@types/LaneBoard.ts';
import type { LaneCardModel }              from './@types/LaneBoard.ts';
import type { LaneFooter }                 from './@types/LaneBoard.ts';
import type { LaneModel }                  from './@types/LaneBoard.ts';
import type { LaneSubtitle }               from './@types/LaneBoard.ts';
import { laneSubCountsOf, subStateNoteOf } from './KanbanLaneText.ts';
import type { ClosedKanbanLane }           from './constants/KanbanBoardLayout.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }    from './constants/KanbanBoardLayout.ts';
import { KANBAN_LANES }                    from './constants/KanbanBoardLayout.ts';
import { KanbanLaneUtil }                  from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                  from './utils/LanePagingUtil.ts';

const NO_ROW_TITLE = 'Low priority: it gets a row on the Progress chart once it is started';

/** From this many tickets waiting on a card, its `↦ N` reads in full ink. */
const HEAVY_HELD_COUNT = 5;

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

/** `↦ N` for an unfinished ticket others wait on; a board without dependencies gets none, so its cards stay as they were. */
function heldCountOf(card: KanbanCard, lane: KanbanLane, format: KanbanCardFormat): LaneCardHeldCount | null {
  const count = KanbanLaneUtil.laneIsClosed(lane) ? 0 : format.dependencyGraph.heldOfTicket.get(card.ticket.id)?.size ?? 0;
  return count === 0
    ? null
    : { count, isHeavy: count >= HEAVY_HELD_COUNT, title: `${count} ${count === 1 ? 'ticket waits' : 'tickets wait'} on this one, directly or further down the chain` };
}

function reviewedTitleOf(card: KanbanCard, lane: KanbanLane, format: KanbanCardFormat): string | null {
  return lane === 'done' && card.ownRow !== null && card.ownRow.deliveredRowCountsAsReviewed ? WorkItemMarkupUtil.reviewedTitleOf(card.ownRow, format.slices) : null;
}

export function kanbanCardModelOf(card: KanbanCard, lane: KanbanLane, format: KanbanCardFormat): LaneCardModel {
  const { ticket, ownRow } = card;
  const priority           = TicketDefaultsUtil.ticketPriorityOf(ticket);
  const { hold }           = ticket;
  return {
    elementId:  TemplateIdUtil.kanbanCardElementIdOf(ticket.id),
    identity:   { attribute: 'data-ticket-id', value: ticket.id },
    stateToken: card.state,
    hasStripe:  ownRow !== null,
    ariaLabel:  `#${ticket.id} ${ticket.title}, ${pillLabelOf(card)}, ${priority} priority`,
    head:       {
      idText:         `#${ticket.id}`,
      priority,
      ticketType:     ticket.type,
      slotMarkup:     null,
      hasNeededFirst: format.dependedOnTicketIds.has(ticket.id),
      heldCount:      heldCountOf(card, lane, format),
      tokenCount:     ownRow?.tokens ?? null,
    },
    title: ticket.title,
    chips: card.epics.length === 0 ? null : { groups: card.epics, vocabulary: EPIC_MARK_VOCABULARY },
    marks: {
      waitingOn:  card.waitingOn.map((identifier) => WorkItemMarkupUtil.ticketLinkOf(identifier, 'kanban-card')),
      heldTitle:  hold === undefined ? null : hold === '' ? 'Held' : `Held: ${hold}`,
      noRowTitle: lane === 'todo' && ownRow === null ? NO_ROW_TITLE : null,
    },
    note:          subStateNoteOf(card, format),
    pill:          KanbanLaneUtil.laneMixesStates(lane) ? pillLabelOf(card) : null,
    reviewedTitle: reviewedTitleOf(card, lane, format),
    stamp:         WorkItemMarkupUtil.latestMilestoneTextsOf(ticket, format.slices, format.todayCalendarDate),
    opensDetail:   true,
  };
}

function todoIsByWave(lane: KanbanLane, input: KanbanBoardInput): boolean {
  return lane === 'todo' && input.todoOrder === 'by-wave';
}

function laneSubtitleOf(lane: KanbanLane, members: readonly KanbanCard[], input: KanbanBoardInput): LaneSubtitle {
  if (todoIsByWave(lane, input)) {
    const readyCount = members.filter((card) => input.readyTicketIds.has(card.ticket.id)).length;
    return { kind: 'text', text: `${readyCount} ready · ${members.length - readyCount} waiting` };
  }
  return { kind: 'counts', leading: LANE_DESIGN[lane].leading, counts: laneSubCountsOf(lane, members) };
}

/**
 * To do by wave: one group per wave holding To do cards, its head naming the wave and how wide all of it is, a one-ticket wave tinted as
 * the bottleneck; within it the wave's own order, pace path first, then most held. A card the graph places in no wave closes the lane.
 */
function todoWaveGroupsOf(members: readonly KanbanCard[], format: KanbanCardFormat, readyTicketIds: ReadonlySet<string>): LaneCardGroup[] {
  const cardById = new Map(members.map((card) => [card.ticket.id, card]));
  const placed   = new Set<string>();
  const groups   = format.dependencyGraph.waves.flatMap((wave): LaneCardGroup[] => {
    const cards = wave.ticketIds.flatMap((ticketId) => cardById.get(ticketId) ?? []);
    if (cards.length === 0) {
      return [];
    }
    cards.forEach((card) => placed.add(card.ticket.id));
    const width      = wave.isNarrow ? 'one at a time' : `${wave.ticketIds.length} side by side`;
    const readyCount = cards.filter((card) => readyTicketIds.has(card.ticket.id)).length;
    return [{
      kind:     'wave',
      index:    wave.index,
      isNarrow: wave.isNarrow,
      label:    wave.label,
      note:     wave.index === 0 ? `${readyCount} ready · ${width}` : width,
      cards:    cards.map((card) => kanbanCardModelOf(card, 'todo', format)),
    }];
  });
  const unplaced = members.filter((card) => !placed.has(card.ticket.id)).map((card) => kanbanCardModelOf(card, 'todo', format));
  return [...groups, { kind: 'plain', cards: unplaced }];
}

function priorityGroupsOf(lane: KanbanLane, shown: readonly KanbanCard[], format: KanbanCardFormat): LaneCardGroup[] {
  const groups: LaneCardGroup[] = [];
  for (const card of shown) {
    const priority = TicketDefaultsUtil.ticketPriorityOf(card.ticket);
    const last     = groups.at(-1);
    if (last?.kind === 'priority' && last.priority === priority) {
      groups[groups.length - 1] = { ...last, cards: [...last.cards, kanbanCardModelOf(card, lane, format)] };
      continue;
    }
    groups.push({
      kind:  'priority',
      priority,
      title: HtmlLabelUtil.priorityGroupTitleOf(priority),
      count: shown.filter((other) => TicketDefaultsUtil.ticketPriorityOf(other.ticket) === priority).length,
      cards: [kanbanCardModelOf(card, lane, format)],
    });
  }
  return groups;
}

function laneBodyOf(lane: KanbanLane, members: readonly KanbanCard[], shown: readonly KanbanCard[], input: KanbanBoardInput): LaneBody {
  if (shown.length === 0) {
    return { kind: 'empty', text: KanbanLaneUtil.laneIsClosed(lane) ? emptyClosedLaneText(lane, input.finishedWork) : EMPTY_LANE_TEXT[lane] };
  }
  const format = kanbanCardFormatOf(input);
  if (todoIsByWave(lane, input)) {
    return { kind: 'groups', groups: todoWaveGroupsOf(shown, format, input.readyTicketIds) };
  }
  if (KanbanLaneUtil.laneIsDividedByPriority(lane, members)) {
    return { kind: 'groups', groups: priorityGroupsOf(lane, shown, format) };
  }
  return { kind: 'groups', groups: [{ kind: 'plain', cards: shown.map((card) => kanbanCardModelOf(card, lane, format)) }] };
}

/** The paging while the lane holds more than a page, then what the finished-work switch leaves out of it; `null` when there is neither. */
export function kanbanLaneFooterOf(shownCount: number, laneCount: number, hiddenCount: number): LaneFooter | null {
  const paging = laneCount <= CAPPED_LANE_FIRST_PAGE_CARDS
    ? null
    : {
      shownCount,
      laneCount,
      nextPageSize:  LanePagingUtil.nextPageSizeFor(shownCount, laneCount),
      firstPageSize: shownCount > CAPPED_LANE_FIRST_PAGE_CARDS ? CAPPED_LANE_FIRST_PAGE_CARDS : null,
    };
  return paging === null && hiddenCount <= 0 ? null : { paging, hiddenCount };
}

export function kanbanLaneModelOf(lane: KanbanLane, input: KanbanBoardInput): LaneModel {
  const members         = KanbanLaneUtil.cardsInLane(input.cards, lane);
  const isClosed        = KanbanLaneUtil.laneIsClosed(lane);
  const shownCount      = isClosed ? LanePagingUtil.cappedLaneShownCount(input.shownCountByClosedLane[lane], members.length) : members.length;
  const laneIsCollapsed = lane === 'abandoned' && !input.abandonedLaneIsOpen;
  const design          = LANE_DESIGN[lane];
  return {
    key:            lane,
    title:          design.title,
    dotState:       design.dotState,
    count:          members.length,
    subtitle:       laneSubtitleOf(lane, members, input),
    cardsElementId: `ap-lane-${lane}-cards`,
    collapse:       lane === 'abandoned' ? { isCollapsed: laneIsCollapsed, toggleTitle: `${laneIsCollapsed ? 'Show' : 'Collapse'} the abandoned tickets` } : null,
    body:           laneBodyOf(lane, members, members.slice(0, shownCount), input),
    footer:         isClosed ? kanbanLaneFooterOf(shownCount, members.length, input.hiddenCountByClosedLane[lane]) : null,
  };
}

export function kanbanLaneModelsOf(input: KanbanBoardInput): LaneModel[] {
  return KANBAN_LANES.map((lane) => kanbanLaneModelOf(lane, input));
}
