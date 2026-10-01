/**
 * The Tickets tab's search, chip filters and sort as pure functions over the Board's tickets: which tickets a view shows, in which order,
 * what each chip would add, and a view read back from a reload snapshot.
 */

import type { DisplayState } from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }   from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { TICKET_TYPES }      from '../../../src/lib/tracker-model/constants/TicketFields.ts';
import type { BoardTicket }  from '../../@types/PageBoard.ts';
import type {
  TicketSortDirection,
  TicketSortKey,
  TicketStatusChip,
  TicketView
} from '../../@types/ViewerChoices.ts';
import { EpicChipUtil }  from '../../utils/EpicChipUtil.ts';
import { JsonValueUtil } from '../../utils/JsonValueUtil.ts';

export const TICKET_STATUS_CHIPS: readonly TicketStatusChip[] = ['pending', 'in-progress', 'paused', 'in-review', 'reviewing', 'reviewed', 'delivered', 'abandoned'];

export const TICKET_SORT_KEYS: readonly TicketSortKey[] = ['id', 'title', 'epic', 'type', 'status', 'branch'];

export const DEFAULT_TICKET_VIEW: TicketView = {
  searchText:    '',
  statusChips:   [],
  typeChips:     [],
  epicChips:     [],
  sortKey:       'id',
  sortDirection: 'descending',
};

const LIFECYCLE_ORDER: readonly DisplayState[] = ['pending', 'in-progress', 'paused', 'in-review', 'reviewing', 're-review', 'reviewed', 'delivered', 'abandoned'];

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

function characterOfReference(reference: string, name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith('#x')) {
    return String.fromCodePoint(Number.parseInt(lowerName.slice(2), HEXADECIMAL_RADIX));
  }
  if (lowerName.startsWith('#')) {
    return String.fromCodePoint(Number.parseInt(lowerName.slice(1), 10));
  }
  return Object.hasOwn(NAMED_CHARACTERS, lowerName) ? NAMED_CHARACTERS[lowerName] ?? reference : reference;
}

/** Every run of white space as one space, so a phrase matches across a line break or the tag a body put inside it. */
function collapsedWhiteSpaceOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The words a reader sees in a rendered body: every tag and its attributes dropped, then the escaped characters read back. */
function bodyPlainTextOf(bodyHtml: string): string {
  return collapsedWhiteSpaceOf(bodyHtml.replace(MARKUP_TAG_PATTERN, ' ').replace(CHARACTER_REFERENCE_PATTERN, characterOfReference));
}

/** Built once per ticket, since a search re-reads it on every keystroke. */
function searchableTextOf(ticket: BoardTicket): string {
  const epicWords = ticket.memberOfEpics.flatMap((epic) => [epic.key, epic.title]);
  return [ticket.title, ...epicWords, ticket.branch ?? '', ticket.group ?? '', bodyPlainTextOf(ticket.bodyHtml)].join('\n').toLowerCase();
}

function normalisedQueryOf(searchText: string): string {
  return collapsedWhiteSpaceOf(searchText).toLowerCase();
}

function queryNamesATicketId(query: string): boolean {
  return TICKET_ID_QUERY_PATTERN.test(query);
}

function searchMatches(ticket: BoardTicket, searchableText: string, query: string): boolean {
  if (query === '') {
    return true;
  }
  if (queryNamesATicketId(query)) {
    return ticket.id.includes(query.replace(/^#/, ''));
  }
  return searchableText.includes(query);
}

function statusChipOf(state: DisplayState): TicketStatusChip {
  return state === 're-review' ? 'reviewing' : state;
}

function viewNarrows(view: TicketView): boolean {
  return normalisedQueryOf(view.searchText) !== '' || view.statusChips.length > 0 || view.typeChips.length > 0 || view.epicChips.length > 0;
}

interface MatchOptions {
  ignoresStatus?: boolean;
  ignoresType?:   boolean;
  ignoresEpic?:   boolean;
}

/** OR inside a chip group, AND across the search and the groups. */
function ticketMatches(ticket: BoardTicket, searchableText: string, view: TicketView, options: MatchOptions = {}): boolean {
  if (!searchMatches(ticket, searchableText, normalisedQueryOf(view.searchText))) {
    return false;
  }
  if (options.ignoresStatus !== true && view.statusChips.length > 0 && !view.statusChips.includes(statusChipOf(ticket.displayState))) {
    return false;
  }
  if (options.ignoresEpic !== true && !EpicChipUtil.pressedChipsKeep(ticket, view.epicChips)) {
    return false;
  }
  return options.ignoresType === true || view.typeChips.length === 0 || view.typeChips.includes(ticket.type);
}

function sortValueOf(ticket: BoardTicket, sortKey: TicketSortKey): number | string {
  switch (sortKey) {
    case 'id':     return Number(ticket.id);
    case 'title':  return ticket.title.toLowerCase();
    case 'type':   return ticket.type;
    case 'status': return LIFECYCLE_ORDER.indexOf(ticket.displayState);
    case 'epic':   return ticket.memberOfEpics[0]?.title.toLowerCase() ?? LAST_IN_ORDER;
    case 'branch': return ticket.branch === undefined || ticket.branch === null || ticket.branch === '' ? LAST_IN_ORDER : ticket.branch.toLowerCase();
    default:       return 0;
  }
}

/** Ties fall back to the newest ticket first, whichever column is sorted. */
function ticketComparatorFor(view: TicketView): (a: BoardTicket, b: BoardTicket) => number {
  return (a, b) => {
    const first  = sortValueOf(a, view.sortKey);
    const second = sortValueOf(b, view.sortKey);
    if (first === second) {
      return Number(b.id) - Number(a.id);
    }
    if (first === LAST_IN_ORDER || second === LAST_IN_ORDER) {
      return first === LAST_IN_ORDER ? 1 : -1;
    }
    const order = first < second ? -1 : 1;
    return view.sortDirection === 'ascending' ? order : -order;
  };
}

/**
 * The unnarrowed table shows the tickets the visibility filter keeps; a search or a pressed chip looks through every ticket, finished ones
 * included, so a match is never hidden by "Hide work finished".
 */
function ticketsShownBy(
  view: TicketView,
  allTickets: readonly BoardTicket[],
  visibleTickets: readonly BoardTicket[],
  searchableTextById: ReadonlyMap<string, string>,
): BoardTicket[] {
  const candidates = viewNarrows(view) ? allTickets : visibleTickets;
  return candidates
    .filter((ticket) => ticketMatches(ticket, searchableTextById.get(ticket.id) ?? '', view))
    .toSorted(ticketComparatorFor(view));
}

/** What pressing each chip would show: every ticket of its value that passes the search and the other group, hidden work included. */
function statusChipCountsOf(view: TicketView, allTickets: readonly BoardTicket[], searchableTextById: ReadonlyMap<string, string>): Map<TicketStatusChip, number> {
  const counts = new Map<TicketStatusChip, number>(TICKET_STATUS_CHIPS.map((chip) => [chip, 0]));
  for (const ticket of allTickets) {
    if (ticketMatches(ticket, searchableTextById.get(ticket.id) ?? '', view, { ignoresStatus: true })) {
      const chip = statusChipOf(ticket.displayState);
      counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
  }
  return counts;
}

function typeChipCountsOf(view: TicketView, allTickets: readonly BoardTicket[], searchableTextById: ReadonlyMap<string, string>): Map<TicketType, number> {
  const counts = new Map<TicketType, number>(TICKET_TYPES.map((type) => [type, 0]));
  for (const ticket of allTickets) {
    if (ticketMatches(ticket, searchableTextById.get(ticket.id) ?? '', view, { ignoresType: true })) {
      counts.set(ticket.type, (counts.get(ticket.type) ?? 0) + 1);
    }
  }
  return counts;
}

function epicChipCountsOf(view: TicketView, allTickets: readonly BoardTicket[], searchableTextById: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ticket of allTickets) {
    if (ticketMatches(ticket, searchableTextById.get(ticket.id) ?? '', view, { ignoresEpic: true })) {
      for (const chip of EpicChipUtil.epicChipsOf(ticket)) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
  }
  return counts;
}

/** A second press on the sorted column reverses it; a new column starts ascending, except the id, which starts newest first. */
function viewSortedBy(view: TicketView, sortKey: TicketSortKey): TicketView {
  if (view.sortKey === sortKey) {
    return { ...view, sortDirection: view.sortDirection === 'ascending' ? 'descending' : 'ascending' };
  }
  return { ...view, sortKey, sortDirection: sortKey === 'id' ? 'descending' : 'ascending' };
}

function toggledValues<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function knownValuesOf<Value extends string>(value: unknown, known: readonly Value[]): Value[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return known.filter((candidate) => value.includes(candidate));
}

/** An unreadable part of a stored view reads as its default, so a half-readable snapshot still restores the rest. */
function ticketViewFrom(value: unknown): TicketView {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return DEFAULT_TICKET_VIEW;
  }
  const sortKey       = TICKET_SORT_KEYS.find((candidate) => candidate === value['sortKey']);
  const sortDirection = (['ascending', 'descending'] as const).find((candidate): candidate is TicketSortDirection => candidate === value['sortDirection']);
  return {
    searchText:    JsonValueUtil.textOrNull(value['searchText']) ?? '',
    statusChips:   knownValuesOf(value['statusChips'], TICKET_STATUS_CHIPS),
    typeChips:     knownValuesOf(value['typeChips'], TICKET_TYPES),
    epicChips:     JsonValueUtil.textListOf(value['epicChips']),
    sortKey:       sortKey ?? DEFAULT_TICKET_VIEW.sortKey,
    sortDirection: sortDirection ?? DEFAULT_TICKET_VIEW.sortDirection,
  };
}

export const TicketViewUtil = {
  bodyPlainTextOf,
  searchableTextOf,
  normalisedQueryOf,
  queryNamesATicketId,
  statusChipOf,
  viewNarrows,
  ticketsShownBy,
  statusChipCountsOf,
  typeChipCountsOf,
  epicChipCountsOf,
  viewSortedBy,
  toggledValues,
  ticketViewFrom,
} as const;
