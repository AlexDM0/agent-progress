import type { ClosedKanbanLane } from '../kanban/constants/KanbanBoardLayout.ts';

export type NameColumnWidth = 'normal' | 'wide';

export type WorkVisibility = 'recent' | 'all';

export interface StoredViewOverride {
  presetKey:   string | null;
  fromText:    string | null;
  toText:      string | null;
  tickMinutes: number | null;
}

export type DetailTargetKind = 'task' | 'ticket' | 'kanban-card';

/** What the detail panel shows: a Progress row by task id, or a ticket line or a Kanban card by ticket id. */
export interface DetailTarget {
  kind: DetailTargetKind;
  id:   string;
}

/** The viewer's place, stored just before the idle reload and restored once after it. */
export interface ReloadSnapshot {
  trackerId:        string;
  tabName:          string;
  windowScrollTop:  number;
  chartScrollLeft:  number;
  chartScrollTop:   number;
  kanbanScrollLeft: number;
  fromText:         string;
  toText:           string;
  logFilterText:    string;
  detailTarget:     DetailTarget | null;
  detailScrollTop:  number;
}

export interface ReloadSnapshotStore {
  write: (snapshot: ReloadSnapshot) => void;
  take:  () => ReloadSnapshot | null;
}

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ViewerPreferences {
  readRangeOverride:         () => StoredViewOverride;
  writeRangeOverride:        (override: StoredViewOverride) => void;
  readWorkVisibility:        () => WorkVisibility;
  writeWorkVisibility:       (visibility: WorkVisibility) => void;
  readNameColumnWidth:       () => NameColumnWidth;
  writeNameColumnWidth:      (width: NameColumnWidth) => void;
  readReviewRowsAreShown:    () => boolean;
  writeReviewRowsAreShown:   (reviewRowsAreShown: boolean) => void;
  readAbandonedLaneIsOpen:   () => boolean;
  writeAbandonedLaneIsOpen:  (laneIsOpen: boolean) => void;
  readCappedLaneShownCount:  (lane: ClosedKanbanLane) => number;
  writeCappedLaneShownCount: (lane: ClosedKanbanLane, shownCount: number) => void;
}
