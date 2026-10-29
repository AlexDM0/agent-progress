/**
 * The Kanban as lanes of card models, from the Overseer's `BoardState` and the pressed epic chips. Which lane a ticket sits in follows its
 * stored status and the merge queue's facts; which ready tickets come first follows the Board's `readyTickets`, so no rule is copied here.
 */
import { TokenCountUtil }                               from '../../../src/lib/token-count/TokenCountUtil.ts';
import type { TicketPriority, TicketSize, TicketType }  from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { KanbanBoardState, KanbanEpicDocument }    from '../../@types/KanbanBoardState.ts';
import type { KanbanFilingDraft, KanbanTicketDocument } from '../../@types/KanbanBoardState.ts';
import { ChipFilterUtil }                               from '../../chips/ChipFilterUtil.ts';
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

export interface KanbanCardModel {
  /** `ticket:<id>` or `draft:<id>`, unique across the board. */
  readonly key:        string;
  readonly ticketId:   string | null;
  readonly idText:     string;
  readonly title:      string;
  /** A display state, or `draft` for both kinds of draft. */
  readonly stateToken: string;
  /** "draft ticket" or "filing draft"; `null` on every other card. */
  readonly draftLabel: string | null;
  readonly size:       TicketSize | null;
  readonly priority:   TicketPriority | null;
  /** Bug or research; a plain ticket shows no type. */
  readonly ticketType: Exclude<TicketType, 'ticket'> | null;
  readonly tokensText: string | null;
  readonly epics:      readonly KanbanEpicChip[];
  readonly waitingOn:  readonly string[];
  readonly heldTitle:  string | null;
  readonly note:       string | null;
  readonly ariaLabel:  string;
  readonly actions:    KanbanCardActions;
}

export interface KanbanLaneModel {
  readonly key:                KanbanLaneKey;
  readonly title:              string;
  readonly dotState:           string;
  readonly cards:              readonly KanbanCardModel[];
  readonly emptyText:          string;
  /** The ids a multi-select Ready may send: the Drafts lane's draft tickets, empty on every other lane. */
  readonly readyableTicketIds: readonly string[];
}

export interface KanbanFilterChipModel {
  readonly value: string;
  readonly label: string;
  readonly slot?: number;
}

export interface KanbanViewModel {
  readonly lanes:        readonly KanbanLaneModel[];
  readonly epicChips:    readonly KanbanFilterChipModel[];
  /** The stored chips still naming a chip on the board; a stored chip whose epic went presses nothing. */
  readonly pressedChips: readonly string[];
  readonly countByChip:  ReadonlyMap<string, number>;
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
  readonly epicByKey: ReadonlyMap<string, KanbanEpicDocument>;
  readonly factsById: ReadonlyMap<string, KanbanBoardState['page']['payload']['boardFacts']['tickets'][number]>;
  readonly tokensAt:  (position: number | null) => number | null;
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
    waitingOn: (facts?.waitingOnTicketIds ?? []).map((ticketId) => `#${ticketId}`),
    heldTitle: heldTitleOf(ticket.hold),
    note:      null,
    ariaLabel: `#${ticket.id} ${ticket.title}, ${isDraft ? 'draft ticket' : `${priority} priority`}`,
    actions:   actionsOf(ticket, lane),
  };
}

function filingDraftCardOf(draft: KanbanFilingDraft): KanbanCardModel {
  const stateLine = DraftWordingUtil.stateLineOf(draft);
  return {
    key:        `draft:${draft.id}`,
    ticketId:   null,
    idText:     draft.id,
    title:      draft.title,
    stateToken: 'draft',
    draftLabel: 'filing draft',
    size:       null,
    priority:   null,
    ticketType: null,
    tokensText: null,
    epics:      [],
    waitingOn:  [],
    heldTitle:  null,
    note:       stateLine,
    ariaLabel:  `Draft ${draft.id} ${draft.title}, ${stateLine}`,
    actions:    NO_ACTIONS,
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

function kanbanModelOf(state: KanbanBoardState, storedPressedChips: readonly string[]): KanbanViewModel {
  const { boardFacts, progress } = state.page.payload;
  const epicChips    = epicChipModelsOf(state);
  const pressedChips = ChipFilterUtil.knownPressedChips(storedPressedChips, new Set(epicChips.map((chip) => chip.value)));
  const epicFilter   = { pressed: pressedChips, chipsOf: epicChipsOf };
  const countByChip  = ChipFilterUtil.chipCountsOf(state.page.tickets, () => true, [epicFilter], epicFilter, epicChips.map((chip) => chip.value));
  const shownTickets = state.page.tickets.filter((ticket) => ChipFilterUtil.itemMatches(ticket, () => true, [epicFilter]));
  const queuedTicketIds = new Set(state.mergeQueue.queuedTicketIds);
  const sources: CardSources = {
    epicByKey: new Map(boardFacts.epics.map((epic) => [epic.key, epic])),
    factsById: new Map(boardFacts.tickets.map((facts) => [facts.ticketId, facts])),
    tokensAt:  (position) => (position === null ? null : progress.tasks[position]?.tokens ?? null),
  };
  const lanes = KANBAN_LANES.map((lane): KanbanLaneModel => {
    const laneTickets = orderedLaneTickets(lane, shownTickets.filter((ticket) => laneOf(ticket, queuedTicketIds) === lane), state);
    const ticketCards = laneTickets.map((ticket) => ticketCardOf(ticket, lane, sources));
    const filingDraftCards = lane === 'drafts' ? (boardFacts.drafts ?? []).map(filingDraftCardOf) : [];
    const design = LANE_DESIGN[lane];
    return {
      key:                lane,
      title:              design.title,
      dotState:           design.dotState,
      cards:              [...ticketCards, ...filingDraftCards],
      emptyText:          design.emptyText,
      readyableTicketIds: lane === 'drafts' ? laneTickets.map((ticket) => ticket.id) : [],
    };
  });
  return {
    lanes, epicChips, pressedChips, countByChip
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The state document as the Kanban reads it, or `null` while it lacks the page payload or the merge queue the Kanban needs. */
function kanbanBoardStateOf(document: unknown): KanbanBoardState | null {
  if (!isRecord(document) || !isRecord(document['page']) || !isRecord(document['mergeQueue'])) return null;
  const { page } = document;
  if (!Array.isArray(page['tickets']) || !isRecord(page['payload']) || !isRecord(page['payload']['boardFacts'])) return null;
  return document as unknown as KanbanBoardState;
}

export const KanbanModel = Object.freeze({ kanbanModelOf, kanbanBoardStateOf });
