import type { ClosedKanbanLane } from './KanbanLane.ts';

export type LogVisibility = 'newest' | 'all';

export type NameColumnWidth = 'normal' | 'wide';

export type WorkVisibility = 'recent' | 'all';

export interface StoredViewOverride {
  presetKey:   string | null;
  fromText:    string | null;
  toText:      string | null;
  tickMinutes: number | null;
}

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ViewerPreferences {
  readRangeOverride:         () => StoredViewOverride;
  writeRangeOverride:        (override: StoredViewOverride) => void;
  readWorkVisibility:        () => WorkVisibility;
  writeWorkVisibility:       (visibility: WorkVisibility) => void;
  readLogVisibility:         () => LogVisibility;
  writeLogVisibility:        (visibility: LogVisibility) => void;
  readNameColumnWidth:       () => NameColumnWidth;
  writeNameColumnWidth:      (width: NameColumnWidth) => void;
  readAbandonedLaneIsOpen:   () => boolean;
  writeAbandonedLaneIsOpen:  (laneIsOpen: boolean) => void;
  readCappedLaneShownCount:  (lane: ClosedKanbanLane) => number;
  writeCappedLaneShownCount: (lane: ClosedKanbanLane, shownCount: number) => void;
}
