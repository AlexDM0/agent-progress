import type { DisplayState }     from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }       from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { ClosedKanbanLane } from '../kanban/constants/KanbanBoardLayout.ts';

export type NameColumnWidth = 'normal' | 'wide';

/** How far back finished work reaches: the switch's own two, then the custom popover's pills. */
export type FinishedWorkSpan = '1h' | '1d' | '6h' | '12h' | '3d' | 'all';

/** Which finished work shows beside the unfinished: a span back from now, or everything finished on or after a local calendar day. */
export type FinishedWorkChoice = FinishedWorkSpan | `since-${string}`;

export interface StoredViewOverride {
  presetKey:   string | null;
  fromText:    string | null;
  toText:      string | null;
  tickMinutes: number | null;
}

export type DetailTargetKind = 'task' | 'ticket' | 'kanban-card' | 'epic';

/** What the detail panel shows: a Progress row by task id, a ticket line or a Kanban card by ticket id, or an epic by key. */
export interface DetailTarget {
  kind: DetailTargetKind;
  id:   string;
}

export type TicketSortKey = 'id' | 'title' | 'epic' | 'type' | 'status' | 'branch';

export type TicketSortDirection = 'ascending' | 'descending';

/** A status chip names one display state, except `reviewing`, which also holds a repeat review's `re-review`. */
export type TicketStatusChip = Exclude<DisplayState, 're-review'>;

/** How the Tickets tab narrows and orders its table: no chip pressed in a group means every value of it. */
export interface TicketView {
  searchText:    string;
  statusChips:   readonly TicketStatusChip[];
  typeChips:     readonly TicketType[];
  /** Epic keys, and `NO_EPIC_CHIP` for the tickets in none. */
  epicChips:     readonly string[];
  sortKey:       TicketSortKey;
  sortDirection: TicketSortDirection;
}

/** What the page showed, keyed by task id and by ticket id: each value is the item's display state and, once it has one, its review round. */
export interface ScreenSignature {
  tasks:   Readonly<Record<string, string>>;
  tickets: Readonly<Record<string, string>>;
}

/** The viewer's place, stored just before the idle reload and restored once after it; `screenSignature` is null in a snapshot without one. */
export interface ReloadSnapshot {
  trackerId:          string;
  tabName:            string;
  windowScrollTop:    number;
  chartScrollLeft:    number;
  chartScrollTop:     number;
  kanbanScrollLeft:   number;
  fromText:           string;
  toText:             string;
  rangePopoverIsOpen: boolean;
  ticketView:         TicketView;
  detailTarget:       DetailTarget | null;
  detailScrollTop:    number;
  screenSignature:    ScreenSignature | null;
}

export interface ReloadSnapshotStore {
  write: (snapshot: ReloadSnapshot) => void;
  take:  () => ReloadSnapshot | null;
}

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ViewerPreferences {
  readRangeOverride:         () => StoredViewOverride;
  writeRangeOverride:        (override: StoredViewOverride) => void;
  readFinishedWorkChoice:    () => FinishedWorkChoice;
  writeFinishedWorkChoice:   (choice: FinishedWorkChoice) => void;
  readNameColumnWidth:       () => NameColumnWidth;
  writeNameColumnWidth:      (width: NameColumnWidth) => void;
  readReviewRowsAreShown:    () => boolean;
  writeReviewRowsAreShown:   (reviewRowsAreShown: boolean) => void;
  readAbandonedLaneIsOpen:   () => boolean;
  writeAbandonedLaneIsOpen:  (laneIsOpen: boolean) => void;
  readCappedLaneShownCount:  (lane: ClosedKanbanLane) => number;
  writeCappedLaneShownCount: (lane: ClosedKanbanLane, shownCount: number) => void;
  readTicketsGroupedByEpic:  () => boolean;
  writeTicketsGroupedByEpic: (ticketsAreGrouped: boolean) => void;
  /** The pressed chips of the Kanban's epic strip: epic keys, and `NO_EPIC_CHIP`. */
  readKanbanEpicFilter:      () => string[];
  writeKanbanEpicFilter:     (pressedChips: readonly string[]) => void;
}
