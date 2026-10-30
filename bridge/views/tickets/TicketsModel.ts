/**
 * The Tickets view as a model, from the Overseer's `BoardState` and the viewer's search, chips and sort, as the static page narrowed and
 * ordered its table: OR inside a chip group, AND across the search and the groups, a digits query looking for an id alone, ties newest first.
 * Each ticket's state and what it waits on are the Board's facts, never derived here.
 */
import type { DisplayState }                                                  from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }                                                    from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                                          from '../../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { TicketsBoardState, TicketsEpicDocument, TicketsTicketDocument } from '../../@types/TicketsBoardState.ts';
import { ChipFilterUtil, type ChipFilter }                                    from '../../chips/ChipFilterUtil.ts';
import type { FilterChip }                                                    from '../../chips/FilterChipGroup.tsx';
import { DisplayStateWordingUtil }                                            from '../../utils/DisplayStateWordingUtil.ts';
import { SearchMatchUtil, type MatchPiece }                                   from '../../utils/SearchMatchUtil.ts';

/** A status chip names one display state, except `reviewing`, which also holds a repeat review's `re-review`. */
export type TicketStatusChip = Exclude<DisplayState, 're-review'>;

export type TicketSortKey = 'id' | 'title' | 'epic' | 'type' | 'status' | 'branch';

export type TicketSortDirection = 'ascending' | 'descending';

export interface TicketView {
  readonly searchText:    string;
  readonly statusChips:   readonly TicketStatusChip[];
  readonly typeChips:     readonly TicketType[];
  /** Epic keys, and `NO_EPIC_CHIP` for the tickets in none. */
  readonly epicChips:     readonly string[];
  readonly sortKey:       TicketSortKey;
  readonly sortDirection: TicketSortDirection;
}

export const TICKET_STATUS_CHIPS: readonly TicketStatusChip[] = [
  'draft', 'pending', 'in-progress', 'paused', 'in-review', 'reviewing', 'reviewed', 'delivered', 'abandoned',
];

export const TICKET_TYPE_CHIPS: readonly TicketType[] = ['ticket', 'bug', 'research'];

export const TICKET_SORT_KEYS: readonly TicketSortKey[] = ['id', 'title', 'epic', 'type', 'status', 'branch'];

/** The epic chip of the tickets in no epic: a space, which an epic key never holds, keeps it apart from every key. */
export const NO_EPIC_CHIP = 'no epic';

/** The board's stored choice and its two values, under the static page's key, so a viewer's grouping keeps its key. */
export const TICKET_GROUPING_CHOICE_NAME = 'ticket-grouping';
export const TICKETS_GROUPED_BY_EPIC_CHOICE = 'epic';
export const TICKETS_FLAT_CHOICE = 'flat';

export const DEFAULT_TICKET_VIEW: TicketView = {
  searchText:    '',
  statusChips:   [],
  typeChips:     [],
  epicChips:     [],
  sortKey:       'id',
  sortDirection: 'descending',
};

const LIFECYCLE_ORDER: readonly DisplayState[] = [
  'draft', 'pending', 'in-progress', 'paused', 'in-review', 'reviewing', 're-review', 'reviewed', 'delivered', 'abandoned',
];

/** A query of digits, with or without its `#`, looks for a ticket id and nothing else, so "12" does not match every body naming a twelve. */
const TICKET_ID_QUERY_PATTERN = /^#?\d+$/;

const MARKUP_TAG_PATTERN          = /<[^>]*>/g;
const CHARACTER_REFERENCE_PATTERN = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
const NAMED_CHARACTERS: Readonly<Record<string, string>> = {
  amp:  '&',
  lt:   '<',
  gt:   '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
};
const HEXADECIMAL_RADIX = 16;

/** A ticket in no epic, or an empty branch, sorts after every named one, whichever way the column runs. */
const LAST_IN_ORDER = '￿';

/** A ticket with the Board's facts about it joined on by id. */
export interface TicketsBoardTicket {
  readonly document:       TicketsTicketDocument;
  readonly displayState:   DisplayState;
  readonly reviewRound:    number;
  readonly waitingOn:      readonly string[];
  /** The epics of its `epics` list the board knows, its primary epic first. */
  readonly memberOfEpics:  readonly TicketsEpicDocument[];
  readonly searchableText: string;
}

export interface TicketRowModel {
  readonly ticketId:     string;
  readonly idText:       string;
  readonly titlePieces:  readonly MatchPiece[];
  /** Normal is unmarked. */
  readonly priority:     'low' | 'high' | null;
  readonly groupPieces:  readonly MatchPiece[];
  readonly waitingOn:    readonly string[];
  readonly epics:        readonly TicketsEpicDocument[];
  /** Bug or research; a plain ticket shows no type. */
  readonly ticketType:   Exclude<TicketType, 'ticket'> | null;
  readonly stateToken:   DisplayState;
  readonly stateLabel:   string;
  readonly branchPieces: readonly MatchPiece[];
  readonly taskText:     string | null;
}

/** Rows under one epic's head row when grouped; one headless group holds every row when flat. */
export interface TicketRowGroupModel {
  readonly key:       string;
  /** The head row's epic; `null` for the group of tickets in none, and for the one flat group. */
  readonly epic:      TicketsEpicDocument | null;
  readonly showsHead: boolean;
  readonly rows:      readonly TicketRowModel[];
}

export interface TicketsViewModel {
  readonly groups:      readonly TicketRowGroupModel[];
  readonly shownCount:  number;
  readonly countText:   string;
  /** What the empty table says was asked, `null` while a row shows or the board has no ticket. */
  readonly emptyText:   string | null;
  readonly narrows:     boolean;
  readonly showsEpics:  boolean;
  readonly statusChips: readonly FilterChip[];
  readonly typeChips:   readonly FilterChip[];
  readonly epicChips:   readonly FilterChip[];
  readonly countByChip: { readonly status: ReadonlyMap<string, number>; readonly type: ReadonlyMap<string, number>; readonly epic: ReadonlyMap<string, number> };
  /** The view with every pressed epic chip the board no longer knows dropped. */
  readonly view:        TicketView;
}

function characterOfReference(reference: string, name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lowerName.slice(2), HEXADECIMAL_RADIX));
  if (lowerName.startsWith('#')) return String.fromCodePoint(Number.parseInt(lowerName.slice(1), 10));
  return Object.hasOwn(NAMED_CHARACTERS, lowerName) ? NAMED_CHARACTERS[lowerName] ?? reference : reference;
}

/** The words a reader sees in a rendered body: every tag and its attributes dropped, then the escaped characters read back. */
function bodyPlainTextOf(bodyHtml: string): string {
  return SearchMatchUtil.collapsedWhiteSpaceOf(bodyHtml.replace(MARKUP_TAG_PATTERN, ' ').replace(CHARACTER_REFERENCE_PATTERN, characterOfReference));
}

function boardTicketsOf(state: TicketsBoardState): TicketsBoardTicket[] {
  const { boardFacts, progress } = state.page.payload;
  const factsById = new Map(boardFacts.tickets.map((facts) => [facts.ticketId, facts]));
  const epicByKey = new Map(boardFacts.epics.map((epic) => [epic.key, epic]));
  return state.page.tickets.map((document) => {
    const facts = factsById.get(document.id);
    const ownRow = facts?.ownRowPosition === null || facts?.ownRowPosition === undefined ? undefined : progress.tasks[facts.ownRowPosition];
    const memberOfEpics = (document.epics ?? []).flatMap((key) => {
      const epic = epicByKey.get(key);
      return epic === undefined ? [] : [epic];
    });
    const epicWords = memberOfEpics.flatMap((epic) => [epic.key, epic.title]);
    return {
      document,
      displayState:   facts?.displayState ?? document.status,
      reviewRound:    ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND,
      waitingOn:      facts?.waitingOnTicketIds ?? [],
      memberOfEpics,
      searchableText: [document.title, ...epicWords, document.branch ?? '', document.group ?? '', bodyPlainTextOf(document.bodyHtml)].join('\n').toLowerCase(),
    };
  });
}

function queryNamesATicketId(query: string): boolean {
  return TICKET_ID_QUERY_PATTERN.test(query);
}

function searchMatches(ticket: TicketsBoardTicket, query: string): boolean {
  if (query === '') return true;
  if (queryNamesATicketId(query)) return ticket.document.id.includes(query.replace(/^#/, ''));
  return ticket.searchableText.includes(query);
}

function statusChipOf(state: DisplayState): TicketStatusChip {
  return state === 're-review' ? 'reviewing' : state;
}

function epicChipsOf(ticket: TicketsBoardTicket): readonly string[] {
  return ticket.memberOfEpics.length === 0 ? [NO_EPIC_CHIP] : ticket.memberOfEpics.map((epic) => epic.key);
}

function viewNarrows(view: TicketView): boolean {
  return SearchMatchUtil.normalisedQueryOf(view.searchText) !== '' || view.statusChips.length > 0 || view.typeChips.length > 0 || view.epicChips.length > 0;
}

interface TicketChipFilters {
  readonly status: ChipFilter<TicketsBoardTicket, TicketStatusChip>;
  readonly type:   ChipFilter<TicketsBoardTicket, TicketType>;
  readonly epic:   ChipFilter<TicketsBoardTicket>;
  readonly all:    ReadonlyArray<ChipFilter<TicketsBoardTicket>>;
}

function ticketChipFiltersOf(view: TicketView): TicketChipFilters {
  const status: ChipFilter<TicketsBoardTicket, TicketStatusChip> = { pressed: view.statusChips, chipsOf: (ticket) => [statusChipOf(ticket.displayState)] };
  const type: ChipFilter<TicketsBoardTicket, TicketType>         = { pressed: view.typeChips, chipsOf: (ticket) => [ticket.document.type] };
  const epic: ChipFilter<TicketsBoardTicket>                     = { pressed: view.epicChips, chipsOf: epicChipsOf };
  return {
    status, type, epic, all: [status, type, epic]
  };
}

function sortValueOf(ticket: TicketsBoardTicket, sortKey: TicketSortKey): number | string {
  const { document } = ticket;
  switch (sortKey) {
    case 'id':     return Number(document.id);
    case 'title':  return document.title.toLowerCase();
    case 'type':   return document.type;
    case 'status': return LIFECYCLE_ORDER.indexOf(ticket.displayState);
    case 'epic':   return ticket.memberOfEpics[0]?.title.toLowerCase() ?? LAST_IN_ORDER;
    case 'branch': return document.branch === undefined || document.branch === '' ? LAST_IN_ORDER : document.branch.toLowerCase();
    default:       return 0;
  }
}

/** Ties fall back to the newest ticket first, whichever column is sorted. */
function ticketComparatorFor(view: TicketView): (a: TicketsBoardTicket, b: TicketsBoardTicket) => number {
  return (a, b) => {
    const first  = sortValueOf(a, view.sortKey);
    const second = sortValueOf(b, view.sortKey);
    if (first === second) return Number(b.document.id) - Number(a.document.id);
    if (first === LAST_IN_ORDER || second === LAST_IN_ORDER) return first === LAST_IN_ORDER ? 1 : -1;
    const order = first < second ? -1 : 1;
    return view.sortDirection === 'ascending' ? order : -order;
  };
}

/** A second press on the sorted column reverses it; a new column starts ascending, except the id, which starts newest first. */
function viewSortedBy(view: TicketView, sortKey: TicketSortKey): TicketView {
  if (view.sortKey === sortKey) return { ...view, sortDirection: view.sortDirection === 'ascending' ? 'descending' : 'ascending' };
  return { ...view, sortKey, sortDirection: sortKey === 'id' ? 'descending' : 'ascending' };
}

function viewCleared(view: TicketView): TicketView {
  return {
    ...view, searchText: '', statusChips: [], typeChips: [], epicChips: []
  };
}

function rowOf(ticket: TicketsBoardTicket, markedQuery: string): TicketRowModel {
  const { document } = ticket;
  const priority = document.priority ?? 'normal';
  return {
    ticketId:     document.id,
    idText:       `#${document.id}`,
    titlePieces:  SearchMatchUtil.matchPiecesOf(document.title, markedQuery),
    priority:     priority === 'normal' ? null : priority,
    groupPieces:  SearchMatchUtil.matchPiecesOf(document.group ?? '', markedQuery),
    waitingOn:    ticket.waitingOn.map((ticketId) => `#${ticketId}`),
    epics:        ticket.memberOfEpics,
    ticketType:   document.type === 'ticket' ? null : document.type,
    stateToken:   ticket.displayState,
    stateLabel:   DisplayStateWordingUtil.stateLabelOf(ticket.displayState, ticket.reviewRound),
    branchPieces: SearchMatchUtil.matchPiecesOf(document.branch ?? '', markedQuery),
    taskText:     document.task === null ? null : `#${document.task}`,
  };
}

function quoted(text: string): string {
  return `“${text}”`;
}

function activeFiltersPhrase(view: TicketView, epicLabelOf: (chip: string) => string): string {
  const parts: string[] = [];
  const query = view.searchText.trim();
  if (query !== '') parts.push(quoted(query));
  if (view.statusChips.length > 0) parts.push(`status ${view.statusChips.map((chip) => DisplayStateWordingUtil.labelOf(chip)).join(' or ')}`);
  if (view.typeChips.length > 0) parts.push(`type ${view.typeChips.join(' or ')}`);
  if (view.epicChips.length > 0) parts.push(`epic ${view.epicChips.map(epicLabelOf).join(' or ')}`);
  return parts.join(', ');
}

function countTextOf(shownCount: number, tickets: readonly TicketsTicketDocument[]): string {
  if (tickets.length === 0) return 'no tickets';
  const inProgressCount = tickets.filter((ticket) => ticket.status === 'in-progress').length;
  const total = `${shownCount} of ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;
  return inProgressCount === 0 ? total : `${total} · ${inProgressCount} in progress`;
}

/** Epics holding an open ticket first, each keeping the Board's order by key. */
function epicsInShownOrder(epics: readonly TicketsEpicDocument[], tickets: readonly TicketsBoardTicket[]): TicketsEpicDocument[] {
  const openEpicKeys = new Set(tickets
    .filter((ticket) => ticket.document.status !== 'delivered' && ticket.document.status !== 'abandoned')
    .flatMap((ticket) => ticket.memberOfEpics.map((epic) => epic.key)));
  return epics.toSorted((a, b) => Number(!openEpicKeys.has(a.key)) - Number(!openEpicKeys.has(b.key)));
}

/** Each epic's shown tickets under its head row, a ticket under its primary epic only, then the tickets in none. */
function groupedRowsOf(
  shown: readonly TicketsBoardTicket[],
  rows: readonly TicketRowModel[],
  epics: readonly TicketsEpicDocument[],
  tickets: readonly TicketsBoardTicket[],
): TicketRowGroupModel[] {
  return [...epicsInShownOrder(epics, tickets), null].flatMap((epic): TicketRowGroupModel[] => {
    const members = rows.filter((_row, index) => (shown[index]?.memberOfEpics[0]?.key ?? null) === (epic?.key ?? null));
    return members.length === 0 ? [] : [{
      key: epic?.key ?? NO_EPIC_CHIP, epic, showsHead: true, rows: members
    }];
  });
}

function ticketsModelOf(state: TicketsBoardState, requestedView: TicketView, groupedByEpic: boolean): TicketsViewModel {
  const tickets    = boardTicketsOf(state);
  const { epics }  = state.page.payload.boardFacts;
  const showsEpics = epics.length > 0;
  const view: TicketView = {
    ...requestedView,
    epicChips: ChipFilterUtil.knownPressedChips(requestedView.epicChips, new Set(showsEpics ? [...epics.map((epic) => epic.key), NO_EPIC_CHIP] : [])),
  };
  const query       = SearchMatchUtil.normalisedQueryOf(view.searchText);
  const matches     = (ticket: TicketsBoardTicket): boolean => searchMatches(ticket, query);
  const filters     = ticketChipFiltersOf(view);
  const shown       = tickets.filter((ticket) => ChipFilterUtil.itemMatches(ticket, matches, filters.all)).toSorted(ticketComparatorFor(view));
  // An id query marks nothing: the digits it looks for are the whole id column's.
  const markedQuery = queryNamesATicketId(query) ? '' : query;
  const rows        = shown.map((ticket) => rowOf(ticket, markedQuery));
  const narrows     = viewNarrows(view);
  const epicTitleByKey = new Map(epics.map((epic) => [epic.key, epic.title]));
  const epicLabelOf = (chip: string): string => epicTitleByKey.get(chip) ?? chip;
  const flatGroup: TicketRowGroupModel = {
    key: 'all', epic: null, showsHead: false, rows
  };
  return {
    groups:      groupedByEpic && showsEpics ? groupedRowsOf(shown, rows, epics, tickets) : [flatGroup],
    shownCount:  shown.length,
    countText:   countTextOf(shown.length, state.page.tickets),
    emptyText:   tickets.length === 0 || shown.length > 0 ? null : `No ticket matches ${narrows ? activeFiltersPhrase(view, epicLabelOf) : 'the view'}.`,
    narrows,
    showsEpics,
    statusChips: TICKET_STATUS_CHIPS.map((chip) => ({ value: chip, label: DisplayStateWordingUtil.labelOf(chip), stateToken: chip })),
    typeChips:   TICKET_TYPE_CHIPS.map((type) => ({ value: type, label: type })),
    epicChips:   showsEpics
      ? [...epics.map((epic): FilterChip => ({ value: epic.key, label: epic.title, slot: epic.slot })), { value: NO_EPIC_CHIP, label: NO_EPIC_CHIP }]
      : [],
    countByChip: {
      status: ChipFilterUtil.chipCountsOf(tickets, matches, filters.all, filters.status, TICKET_STATUS_CHIPS),
      type:   ChipFilterUtil.chipCountsOf(tickets, matches, filters.all, filters.type, TICKET_TYPE_CHIPS),
      epic:   ChipFilterUtil.chipCountsOf(tickets, matches, filters.all, filters.epic),
    },
    view,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The state document as the Tickets view reads it, or `null` while it lacks the page payload. */
function ticketsBoardStateOf(document: unknown): TicketsBoardState | null {
  if (!isRecord(document) || !isRecord(document['page'])) return null;
  const { page } = document;
  if (!Array.isArray(page['tickets']) || !isRecord(page['payload'])) return null;
  const { payload } = page;
  if (!isRecord(payload['boardFacts']) || !isRecord(payload['progress']) || !isRecord(payload['limits'])) return null;
  return document as unknown as TicketsBoardState;
}

export const TicketsModel = Object.freeze({
  bodyPlainTextOf,
  boardTicketsOf,
  ticketsModelOf,
  ticketsBoardStateOf,
  viewSortedBy,
  viewCleared,
});
