/**
 * The Kanban as lanes of card models, from the Overseer's `BoardState` and the pressed epic chips. Which lane a ticket sits in follows its
 * stored status and the merge queue's facts; which ready tickets come first follows the Board's `readyTickets`, so no rule is copied here.
 */
import { TokenCountUtil }                               from '../../../src/lib/token-count/TokenCountUtil.ts';
import type { TicketPriority, TicketSize, TicketType }  from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { DependencyGraph }                         from '../../@types/DependencyGraph.ts';
import type { KanbanBoardState, KanbanEpicDocument }    from '../../@types/KanbanBoardState.ts';
import type { KanbanFilingDraft, KanbanTicketDocument } from '../../@types/KanbanBoardState.ts';
import { ChipFilterUtil }                               from '../../chips/ChipFilterUtil.ts';
import { DependencyGraphUtil }                          from '../../utils/DependencyGraphUtil.ts';
import { DraftWordingUtil }                             from '../../utils/DraftWordingUtil.ts';

export const KANBAN_LANES = ['drafts', 'ready', 'building', 'in-review', 'merge-queue', 'done', 'abandoned'] as const;

export type KanbanLaneKey = typeof KANBAN_LANES[number];

/** The epic filter chip of the tickets in no epic: a space, which an epic key never holds, keeps it apart from every key. */
export const NO_EPIC_CHIP = 'no epic';

/** The board's stored choice, under the key the static page used, so a viewer's pressed epics keep their key. */
export const KANBAN_EPIC_FILTER_CHOICE_NAME = 'kanban-epics';

const PRIORITY_ORDER: readonly TicketPriority[] = ['high', 'normal', 'low'];

interface LaneDesign {
  readonly title:     string;
  /** The state token its head's dot is coloured by. */
  readonly dotState:  string;
  readonly emptyText: string;
}

const LANE_DESIGN: Readonly<Record<KanbanLaneKey, LaneDesign>> = {
  'drafts':      { title: 'Drafts', dotState: 'draft', emptyText: 'No draft waiting.' },
  'ready':       { title: 'Ready', dotState: 'pending', emptyText: 'Nothing waiting to start.' },
  'building':    { title: 'Building', dotState: 'in-progress', emptyText: 'Nothing being built.' },
  'in-review':   { title: 'In review', dotState: 'in-review', emptyText: 'Nothing in review.' },
  'merge-queue': { title: 'Merge queue', dotState: 'reviewed', emptyText: 'Nothing awaiting merge.' },
  'done':        { title: 'Done', dotState: 'delivered', emptyText: 'Nothing done yet.' },
  'abandoned':   { title: 'Abandoned', dotState: 'abandoned', emptyText: 'Nothing abandoned.' },
};

export interface KanbanEpicChip {
  readonly key:   string;
  readonly title: string;
  readonly slot:  number;
}

/** What a card offers; each is a `ControlCommand` the Overseer applies or refuses. */
export interface KanbanCardActions {
  /** A draft ticket: `ticket-ready`. */
  readonly readies:         boolean;
  /** A ready-lane ticket: `ticket-hold` or `ticket-unhold`, `null` elsewhere. */
  readonly holdMove:        'hold' | 'unhold' | null;
  /** A ready-lane ticket: the priorities `ticket-priority` may move it to, every one but its own. */
  readonly priorityChoices: readonly TicketPriority[];
}

/** `↦ N`: how many open tickets wait on an unfinished one, directly or further down the chain. */
export interface KanbanHeldCount {
  readonly count:   number;
  /** From `HEAVY_HELD_COUNT` waiting tickets on, the mark reads in full ink. */
  readonly isHeavy: boolean;
  readonly title:   string;
}

export interface KanbanCardModel {
  /** `ticket:<id>` or `draft:<id>`, unique across the board. */
  readonly key:                string;
  readonly ticketId:           string | null;
  readonly idText:             string;
  readonly title:              string;
  /** A display state, or `draft` for both kinds of draft. */
  readonly stateToken:         string;
  /** "draft ticket" or "filing draft"; `null` on every other card. */
  readonly draftLabel:         string | null;
  readonly size:               TicketSize | null;
  readonly priority:           TicketPriority | null;
  /** Bug or research; a plain ticket shows no type. */
  readonly ticketType:         Exclude<TicketType, 'ticket'> | null;
  readonly tokensText:         string | null;
  readonly epics:              readonly KanbanEpicChip[];
  readonly waitingOn:          readonly string[];
  readonly heldTitle:          string | null;
  readonly note:               string | null;
  readonly ariaLabel:          string;
  readonly actions:            KanbanCardActions;
  /** Another ticket depends on this one: its card can show "needed first" while a dependent is hovered. */
  readonly hasNeededFirst:     boolean;
  readonly heldCount:          KanbanHeldCount | null;
  /** The tickets this one directly depends on, which its hover arrows come from. */
  readonly dependsOnTicketIds: readonly string[];
}

/** A wave of the Ready lane ordered by wave; `null` label on the closing group of tickets the graph places in no wave. */
export interface KanbanWaveGroupModel {
  readonly key:      string;
  readonly label:    string | null;
  readonly note:     string | null;
  /** A one-ticket wave: the bottleneck. */
  readonly isNarrow: boolean;
  readonly cards:    readonly KanbanCardModel[];
}

export interface KanbanLanePaging {
  readonly shownCount:    number;
  readonly laneCount:     number;
  /** 0 once every card shows. */
  readonly nextPageSize:  number;
  /** The first page's size while more than it shows, so the lane can go back to it; otherwise `null`. */
  readonly firstPageSize: number | null;
}

export interface KanbanLaneCollapse {
  readonly isCollapsed: boolean;
  readonly toggleTitle: string;
}

export interface KanbanLaneModel {
  readonly key:                KanbanLaneKey;
  readonly title:              string;
  readonly dotState:           string;
  /** Every card in the lane, paged or not. */
  readonly count:              number;
  /** The cards shown, in order: a closed lane's current pages, the Ready lane in wave order when it is ordered by wave. */
  readonly cards:              readonly KanbanCardModel[];
  /** The Ready lane ordered by wave, `cards` divided into its waves; `null` otherwise. */
  readonly waveGroups:         readonly KanbanWaveGroupModel[] | null;
  readonly paging:             KanbanLanePaging | null;
  /** The Abandoned lane's fold; `null` on every other lane. */
  readonly collapse:           KanbanLaneCollapse | null;
  readonly emptyText:          string;
  /** The ids a multi-select Ready may send: the Drafts lane's draft tickets, empty on every other lane. */
  readonly readyableTicketIds: readonly string[];
}

/** `filed` is the Board's order to take the ready tickets; the stored values are the static page's. */
export const KANBAN_READY_ORDERS = ['filed', 'by-wave'] as const;

export type KanbanReadyOrder = typeof KANBAN_READY_ORDERS[number];

export type KanbanClosedLaneKey = 'done' | 'abandoned';

/** The viewer's layout choices the model lays the lanes out by. */
export interface KanbanLayoutChoices {
  readonly readyOrder:             KanbanReadyOrder;
  readonly abandonedLaneIsOpen:    boolean;
  /** The cards a closed lane was asked to show; clamped to its first page and its count. */
  readonly shownCountByClosedLane: Readonly<Record<KanbanClosedLaneKey, number>>;
}

export const CLOSED_LANE_FIRST_PAGE_CARDS = 15;

export const CLOSED_LANE_PAGE_STEP_CARDS = 25;

/** From this many tickets waiting on a card, its `↦ N` reads in full ink. */
const HEAVY_HELD_COUNT = 5;

export const DEFAULT_KANBAN_LAYOUT: KanbanLayoutChoices = {
  readyOrder:             'filed',
  abandonedLaneIsOpen:    false,
  shownCountByClosedLane: { done: CLOSED_LANE_FIRST_PAGE_CARDS, abandoned: CLOSED_LANE_FIRST_PAGE_CARDS },
};

/** Stored under the static page's keys and values, so a viewer's choices carry over. */
export const KANBAN_READY_ORDER_CHOICE_NAME = 'kanban-todo-order';
export const KANBAN_ABANDONED_LANE_CHOICE_NAME = 'kanban-abandoned';
export const ABANDONED_LANE_OPEN_CHOICE = 'open';
export const ABANDONED_LANE_CLOSED_CHOICE = 'closed';
// A literal map rather than the lane value, so renaming a lane cannot move a viewer's stored key.
export const CLOSED_LANE_SHOWN_CHOICE_NAME: Readonly<Record<KanbanClosedLaneKey, string>> = {
  done:      'kanban-done-shown',
  abandoned: 'kanban-abandoned-shown',
};

/** A hover arrow's source: a shown card the hovered card directly depends on. */
export interface KanbanDependencyArrowLink {
  readonly dependencyCardKey: string;
  readonly isSameLane:        boolean;
}

export interface KanbanFilterChipModel {
  readonly value: string;
  readonly label: string;
  readonly slot?: number;
}

export interface KanbanViewModel {
  readonly lanes:                readonly KanbanLaneModel[];
  readonly epicChips:            readonly KanbanFilterChipModel[];
  /** The stored chips still naming a chip on the board; a stored chip whose epic went presses nothing. */
  readonly pressedChips:         readonly string[];
  readonly countByChip:          ReadonlyMap<string, number>;
  /** Some ticket depends on another; without one the Ready lane offers no wave order. */
  readonly boardHasDependencies: boolean;
  /** The order the Ready lane is in: `filed` on a board without dependencies, whatever was stored. */
  readonly readyOrder:           KanbanReadyOrder;
}

const NO_ACTIONS: KanbanCardActions = { readies: false, holdMove: null, priorityChoices: [] };

function priorityOf(ticket: KanbanTicketDocument): TicketPriority {
  return ticket.priority ?? 'normal';
}

function laneOf(ticket: KanbanTicketDocument, queuedTicketIds: ReadonlySet<string>): KanbanLaneKey {
  if (queuedTicketIds.has(ticket.id)) return 'merge-queue';
  switch (ticket.status) {
    case 'draft':
      return 'drafts';
    case 'pending':
      return 'ready';
    case 'in-progress':
      return 'building';
    case 'in-review':
      return 'in-review';
    case 'reviewed':
      return 'merge-queue';
    case 'delivered':
      return 'done';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'ready';
  }
}

function epicChipsOf(ticket: KanbanTicketDocument): readonly string[] {
  const epicKeys = ticket.epics ?? [];
  return epicKeys.length === 0 ? [NO_EPIC_CHIP] : epicKeys;
}

function heldTitleOf(hold: string | undefined): string | null {
  if (hold === undefined) return null;
  return hold === '' ? 'Held' : `Held: ${hold}`;
}

function actionsOf(ticket: KanbanTicketDocument, lane: KanbanLaneKey): KanbanCardActions {
  if (lane === 'drafts') return { ...NO_ACTIONS, readies: true };
  if (lane !== 'ready') return NO_ACTIONS;
  const priority = priorityOf(ticket);
  return {
    readies:         false,
    holdMove:        ticket.hold === undefined ? 'hold' : 'unhold',
    priorityChoices: PRIORITY_ORDER.filter((choice) => choice !== priority),
  };
}

interface CardSources {
  readonly epicByKey:           ReadonlyMap<string, KanbanEpicDocument>;
  readonly factsById:           ReadonlyMap<string, KanbanBoardState['page']['payload']['boardFacts']['tickets'][number]>;
  readonly tokensAt:            (position: number | null) => number | null;
  readonly graph:               DependencyGraph;
  /** Every ticket some ticket on the board depends on. */
  readonly dependedOnTicketIds: ReadonlySet<string>;
}

function laneIsClosed(lane: KanbanLaneKey): lane is KanbanClosedLaneKey {
  return lane === 'done' || lane === 'abandoned';
}

/** `↦ N` for an unfinished ticket others wait on; a board without dependencies gets none. */
function heldCountOf(ticketId: string, lane: KanbanLaneKey, graph: DependencyGraph): KanbanHeldCount | null {
  const count = laneIsClosed(lane) ? 0 : graph.heldOfNode.get(ticketId)?.size ?? 0;
  return count === 0
    ? null
    : { count, isHeavy: count >= HEAVY_HELD_COUNT, title: `${count} ${count === 1 ? 'ticket waits' : 'tickets wait'} on this one, directly or further down the chain` };
}

function ticketCardOf(ticket: KanbanTicketDocument, lane: KanbanLaneKey, sources: CardSources): KanbanCardModel {
  const facts    = sources.factsById.get(ticket.id);
  const tokens   = sources.tokensAt(facts?.ownRowPosition ?? null);
  const priority = priorityOf(ticket);
  const isDraft  = lane === 'drafts';
  return {
    key:        `ticket:${ticket.id}`,
    ticketId:   ticket.id,
    idText:     `#${ticket.id}`,
    title:      ticket.title,
    stateToken: isDraft ? 'draft' : facts?.displayState ?? ticket.status,
    draftLabel: isDraft ? 'draft ticket' : null,
    size:       ticket.size ?? null,
    priority:   isDraft ? null : priority,
    ticketType: ticket.type === 'ticket' ? null : ticket.type,
    tokensText: tokens === null ? null : `${TokenCountUtil.formatTokenCount(tokens)} tokens`,
    epics:      (ticket.epics ?? []).flatMap((key) => {
      const epic = sources.epicByKey.get(key);
      return epic === undefined ? [] : [{ key: epic.key, title: epic.title, slot: epic.slot }];
    }),
    waitingOn:          (facts?.waitingOnTicketIds ?? []).map((ticketId) => `#${ticketId}`),
    heldTitle:          heldTitleOf(ticket.hold),
    note:               null,
    ariaLabel:          `#${ticket.id} ${ticket.title}, ${isDraft ? 'draft ticket' : `${priority} priority`}`,
    actions:            actionsOf(ticket, lane),
    hasNeededFirst:     sources.dependedOnTicketIds.has(ticket.id),
    heldCount:          heldCountOf(ticket.id, lane, sources.graph),
    dependsOnTicketIds: ticket.dependsOn ?? [],
  };
}

function filingDraftCardOf(draft: KanbanFilingDraft): KanbanCardModel {
  const stateLine = DraftWordingUtil.stateLineOf(draft);
  return {
    key:                `draft:${draft.id}`,
    ticketId:           null,
    idText:             draft.id,
    title:              draft.title,
    stateToken:         'draft',
    draftLabel:         'filing draft',
    size:               null,
    priority:           null,
    ticketType:         null,
    tokensText:         null,
    epics:              [],
    waitingOn:          [],
    heldTitle:          null,
    note:               stateLine,
    ariaLabel:          `Draft ${draft.id} ${draft.title}, ${stateLine}`,
    actions:            NO_ACTIONS,
    hasNeededFirst:     false,
    heldCount:          null,
    dependsOnTicketIds: [],
  };
}

function byPriorityThenId(a: KanbanTicketDocument, b: KanbanTicketDocument): number {
  return PRIORITY_ORDER.indexOf(priorityOf(a)) - PRIORITY_ORDER.indexOf(priorityOf(b)) || a.id.localeCompare(b.id);
}

/** Ready tickets in the Board's order to take them, then the waiting ones; the merge queue in its queue order; closed lanes newest first. */
function orderedLaneTickets(lane: KanbanLaneKey, tickets: readonly KanbanTicketDocument[], state: KanbanBoardState): KanbanTicketDocument[] {
  const leadingIds = lane === 'ready'
    ? state.page.payload.boardFacts.readyTickets.map((ready) => ready.id)
    : lane === 'merge-queue' ? state.mergeQueue.queuedTicketIds : [];
  const leadingPlace = new Map(leadingIds.map((ticketId, index) => [ticketId, index]));
  const closingStamp = (ticket: KanbanTicketDocument): string => (lane === 'done' ? ticket.delivered : ticket.abandonedAt) ?? '';
  return [...tickets].sort((a, b) => {
    if (lane === 'done' || lane === 'abandoned') return closingStamp(b).localeCompare(closingStamp(a)) || a.id.localeCompare(b.id);
    const placeOfA = leadingPlace.get(a.id) ?? leadingIds.length;
    const placeOfB = leadingPlace.get(b.id) ?? leadingIds.length;
    return placeOfA - placeOfB || byPriorityThenId(a, b);
  });
}

/** Over every ticket on the board, whatever the epic chips show, so a wave and `↦ N` never change with the filter. */
function dependencyGraphOf(state: KanbanBoardState): DependencyGraph {
  const graphTickets = state.page.tickets.map((ticket) => ({ ...ticket, memberOfEpics: (ticket.epics ?? []).map((key) => ({ key })) }));
  return DependencyGraphUtil.dependencyGraphOf(graphTickets, state.page.payload.concurrency.limit);
}

/** A requested count is clamped to the first page … the lane's count, so a lane that shrank never shows an empty page. */
function cappedLaneShownCount(requested: number, laneCount: number): number {
  const wholeRequest = Number.isSafeInteger(requested) ? requested : CLOSED_LANE_FIRST_PAGE_CARDS;
  return Math.max(CLOSED_LANE_FIRST_PAGE_CARDS, Math.min(wholeRequest, laneCount));
}

function shownCountAfterMore(shownCount: number, laneCount: number): number {
  return cappedLaneShownCount(shownCount + CLOSED_LANE_PAGE_STEP_CARDS, laneCount);
}

/** Paging only while the lane holds more than its first page. */
function lanePagingOf(shownCount: number, laneCount: number): KanbanLanePaging | null {
  if (laneCount <= CLOSED_LANE_FIRST_PAGE_CARDS) return null;
  return {
    shownCount,
    laneCount,
    nextPageSize:  Math.min(CLOSED_LANE_PAGE_STEP_CARDS, laneCount - shownCount),
    firstPageSize: shownCount > CLOSED_LANE_FIRST_PAGE_CARDS ? CLOSED_LANE_FIRST_PAGE_CARDS : null,
  };
}

function abandonedLaneCollapseOf(laneIsOpen: boolean): KanbanLaneCollapse {
  return { isCollapsed: !laneIsOpen, toggleTitle: `${laneIsOpen ? 'Collapse' : 'Show'} the abandoned tickets` };
}

/**
 * The Ready lane by wave: one group per wave holding Ready cards, in the wave's own order (pace path first, then most held), its note
 * how wide all of the wave is and, on the first, how many are ready; a card the graph places in no wave closes the lane.
 */
function waveGroupsOf(cards: readonly KanbanCardModel[], graph: DependencyGraph, readyTicketIds: ReadonlySet<string>): KanbanWaveGroupModel[] {
  const cardById = new Map(cards.flatMap((card) => (card.ticketId === null ? [] : [[card.ticketId, card] as const])));
  const placedIds = new Set<string>();
  const groups = graph.waves.flatMap((wave): KanbanWaveGroupModel[] => {
    const waveCards = wave.nodeIds.flatMap((ticketId) => cardById.get(ticketId) ?? []);
    if (waveCards.length === 0) return [];
    waveCards.forEach((card) => placedIds.add(card.ticketId ?? ''));
    const width = wave.isNarrow ? 'one at a time' : `${wave.nodeIds.length} side by side`;
    const readyCount = waveCards.filter((card) => readyTicketIds.has(card.ticketId ?? '')).length;
    return [{
      key:      `wave-${wave.index}`,
      label:    wave.label,
      note:     wave.index === 0 ? `${readyCount} ready · ${width}` : width,
      isNarrow: wave.isNarrow,
      cards:    waveCards,
    }];
  });
  const unplacedCards = cards.filter((card) => !placedIds.has(card.ticketId ?? ''));
  return unplacedCards.length === 0
    ? groups
    : [...groups, {
      key: 'unplaced', label: null, note: null, isNarrow: false, cards: unplacedCards
    }];
}

/** Only an epic holding an open ticket gets a chip, and the no-epic chip only while an open ticket is in no epic. */
function epicChipModelsOf(state: KanbanBoardState): KanbanFilterChipModel[] {
  const openTickets = state.page.tickets.filter((ticket) => ticket.status !== 'delivered' && ticket.status !== 'abandoned');
  const openEpicKeys = new Set(openTickets.flatMap((ticket) => ticket.epics ?? []));
  const epicChips = state.page.payload.boardFacts.epics
    .filter((epic) => openEpicKeys.has(epic.key))
    .map((epic): KanbanFilterChipModel => ({ value: epic.key, label: epic.title, slot: epic.slot }));
  const anyOpenTicketIsInNoEpic = openTickets.some((ticket) => (ticket.epics ?? []).length === 0);
  return anyOpenTicketIsInNoEpic ? [...epicChips, { value: NO_EPIC_CHIP, label: 'No epic' }] : epicChips;
}

function kanbanModelOf(state: KanbanBoardState, storedPressedChips: readonly string[], layout: KanbanLayoutChoices = DEFAULT_KANBAN_LAYOUT): KanbanViewModel {
  const { boardFacts, progress } = state.page.payload;
  const epicChips    = epicChipModelsOf(state);
  const pressedChips = ChipFilterUtil.knownPressedChips(storedPressedChips, new Set(epicChips.map((chip) => chip.value)));
  const epicFilter   = { pressed: pressedChips, chipsOf: epicChipsOf };
  const countByChip  = ChipFilterUtil.chipCountsOf(state.page.tickets, () => true, [epicFilter], epicFilter, epicChips.map((chip) => chip.value));
  const shownTickets = state.page.tickets.filter((ticket) => ChipFilterUtil.itemMatches(ticket, () => true, [epicFilter]));
  const queuedTicketIds = new Set(state.mergeQueue.queuedTicketIds);
  const sources: CardSources = {
    epicByKey:           new Map(boardFacts.epics.map((epic) => [epic.key, epic])),
    factsById:           new Map(boardFacts.tickets.map((facts) => [facts.ticketId, facts])),
    tokensAt:            (position) => (position === null ? null : progress.tasks[position]?.tokens ?? null),
    graph:               dependencyGraphOf(state),
    dependedOnTicketIds: new Set(state.page.tickets.flatMap((ticket) => ticket.dependsOn ?? [])),
  };
  const boardHasDependencies = sources.dependedOnTicketIds.size > 0;
  const readyOrder = boardHasDependencies ? layout.readyOrder : 'filed';
  const readyTicketIds = new Set(boardFacts.readyTickets.filter((ready) => ready.held !== true).map((ready) => ready.id));
  const lanes = KANBAN_LANES.map((lane): KanbanLaneModel => {
    const laneTickets = orderedLaneTickets(lane, shownTickets.filter((ticket) => laneOf(ticket, queuedTicketIds) === lane), state);
    const shownCount = laneIsClosed(lane) ? cappedLaneShownCount(layout.shownCountByClosedLane[lane], laneTickets.length) : laneTickets.length;
    const ticketCards = laneTickets.slice(0, shownCount).map((ticket) => ticketCardOf(ticket, lane, sources));
    const filingDraftCards = lane === 'drafts' ? (boardFacts.drafts ?? []).map(filingDraftCardOf) : [];
    const waveGroups = lane === 'ready' && readyOrder === 'by-wave' ? waveGroupsOf(ticketCards, sources.graph, readyTicketIds) : null;
    const design = LANE_DESIGN[lane];
    return {
      key:                lane,
      title:              design.title,
      dotState:           design.dotState,
      count:              laneTickets.length + filingDraftCards.length,
      cards:              waveGroups === null ? [...ticketCards, ...filingDraftCards] : waveGroups.flatMap((group) => group.cards),
      waveGroups,
      paging:             laneIsClosed(lane) ? lanePagingOf(shownCount, laneTickets.length) : null,
      collapse:           lane === 'abandoned' ? abandonedLaneCollapseOf(layout.abandonedLaneIsOpen) : null,
      emptyText:          design.emptyText,
      readyableTicketIds: lane === 'drafts' ? laneTickets.map((ticket) => ticket.id) : [],
    };
  });
  return {
    lanes, epicChips, pressedChips, countByChip, boardHasDependencies, readyOrder
  };
}

/**
 * The hover arrows of `hoveredTicketId`'s card: one from each card it directly depends on, where both show; a card in the folded
 * Abandoned lane or past a closed lane's pages shows nowhere.
 */
function dependencyArrowLinksOf(model: KanbanViewModel, hoveredTicketId: string): KanbanDependencyArrowLink[] {
  const laneOfCardKey = new Map(model.lanes
    .filter((lane) => lane.collapse?.isCollapsed !== true)
    .flatMap((lane) => lane.cards.map((card) => [card.key, lane.key] as const)));
  const hoveredCardKey = `ticket:${hoveredTicketId}`;
  const hoveredLane = laneOfCardKey.get(hoveredCardKey);
  const hoveredCard = model.lanes.flatMap((lane) => lane.cards).find((card) => card.key === hoveredCardKey);
  if (hoveredLane === undefined || hoveredCard === undefined) return [];
  return hoveredCard.dependsOnTicketIds.flatMap((dependencyId) => {
    const dependencyCardKey = `ticket:${dependencyId}`;
    const dependencyLane = laneOfCardKey.get(dependencyCardKey);
    return dependencyLane === undefined ? [] : [{ dependencyCardKey, isSameLane: dependencyLane === hoveredLane }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The state document as the Kanban reads it, or `null` while it lacks the page payload or the merge queue the Kanban needs. */
function kanbanBoardStateOf(document: unknown): KanbanBoardState | null {
  if (!isRecord(document) || !isRecord(document['page']) || !isRecord(document['mergeQueue'])) return null;
  const { page } = document;
  if (!Array.isArray(page['tickets']) || !isRecord(page['payload']) || !isRecord(page['payload']['boardFacts'])) return null;
  if (!isRecord(page['payload']['concurrency'])) return null;
  return document as unknown as KanbanBoardState;
}

export const KanbanModel = Object.freeze({
  kanbanModelOf, kanbanBoardStateOf, dependencyArrowLinksOf, cappedLaneShownCount, shownCountAfterMore
});
