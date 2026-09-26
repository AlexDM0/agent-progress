/**
 * The viewer's stored page choices: their types and defaults, the key strings, the parsing with defaults, and the reads and writes. The one
 * module where the page script touches browser storage; the template's bootstrap keeps its own theme, tab and open-ticket keys.
 */

import type { ClosedKanbanLane }  from '../constants/KanbanLane.ts';
import { CAPPED_LANE_FIRST_PAGE } from '../constants/KanbanLane.ts';
import { JsonValueUtil }          from '../utils/JsonValueUtil.ts';

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

export const DEFAULT_LOG_VISIBILITY: LogVisibility = 'newest';

export const DEFAULT_NAME_COLUMN_WIDTH: NameColumnWidth = 'normal';

export const DEFAULT_WORK_VISIBILITY: WorkVisibility = 'recent';

export const DEFAULT_ABANDONED_LANE_CHOICE = 'closed';

export const EMPTY_VIEW_OVERRIDE: StoredViewOverride = {
  presetKey:   null,
  fromText:    null,
  toText:      null,
  tickMinutes: null,
};

const ABANDONED_LANE_OPEN_CHOICE = 'open';

// A literal map rather than the lane value, so renaming a lane cannot move a viewer's stored key.
const CAPPED_LANE_KEY_SUFFIX: Readonly<Record<ClosedKanbanLane, string>> = {
  done:      'kanban-done-shown',
  abandoned: 'kanban-abandoned-shown',
};

/** `file://` is one origin in Chrome, so the tracker id is what keeps two dashboards' ranges apart. */
export function rangeOverrideStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}`;
}

/** Every other choice's key is the range key plus the choice's own name. */
function choiceStorageKeyFor(trackerId: string, choiceName: string): string {
  return `${rangeOverrideStorageKeyFor(trackerId)}:${choiceName}`;
}

export function workVisibilityStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'visibility');
}

export function logVisibilityStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'log');
}

export function nameColumnWidthStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'name-column');
}

export function abandonedLaneStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'kanban-abandoned');
}

export function cappedLaneStorageKeyFor(trackerId: string, lane: ClosedKanbanLane): string {
  return choiceStorageKeyFor(trackerId, CAPPED_LANE_KEY_SUFFIX[lane]);
}

export function storedOverrideFrom(value: unknown): StoredViewOverride {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return EMPTY_VIEW_OVERRIDE;
  }
  return {
    presetKey:   JsonValueUtil.textOrNull(value['presetKey']),
    fromText:    JsonValueUtil.textOrNull(value['fromText']),
    toText:      JsonValueUtil.textOrNull(value['toText']),
    tickMinutes: JsonValueUtil.finiteNumberOrNull(value['tickMinutes']),
  };
}

export function overrideIsEmpty(override: StoredViewOverride): boolean {
  return override.fromText === null && override.toText === null && override.tickMinutes === null;
}

export function workVisibilityFrom(value: unknown): WorkVisibility {
  return value === 'all' ? 'all' : DEFAULT_WORK_VISIBILITY;
}

export function logVisibilityFrom(value: unknown): LogVisibility {
  return value === 'all' ? 'all' : DEFAULT_LOG_VISIBILITY;
}

export function toggledLogVisibility(visibility: LogVisibility): LogVisibility {
  return visibility === 'all' ? 'newest' : 'all';
}

export function nameColumnWidthFrom(value: unknown): NameColumnWidth {
  return value === 'wide' ? 'wide' : DEFAULT_NAME_COLUMN_WIDTH;
}

export function toggledNameColumnWidth(width: NameColumnWidth): NameColumnWidth {
  return width === 'wide' ? 'normal' : 'wide';
}

export function abandonedLaneIsOpenFrom(stored: string | null): boolean {
  return stored === ABANDONED_LANE_OPEN_CHOICE;
}

/** The closed choice is the default, which the page stores by removing the key. */
export function abandonedLaneChoiceFor(laneIsOpen: boolean): string {
  return laneIsOpen ? ABANDONED_LANE_OPEN_CHOICE : DEFAULT_ABANDONED_LANE_CHOICE;
}

export function shownCountFrom(stored: string | null): number {
  return stored === null ? CAPPED_LANE_FIRST_PAGE : Number(stored);
}

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

/** `storageOf` is called inside each read and write, because merely reaching `window.localStorage` throws where storage is blocked. */
export function createViewerPreferences(trackerId: string, storageOf: () => PreferenceStorage): ViewerPreferences {
  const readStoredChoice = (storageKey: string): string | null => {
    try {
      return storageOf().getItem(storageKey);
    } catch {
      return null;
    }
  };

  /** `null` removes the key, so a viewer who never departs from a default leaves nothing behind. */
  const writeStoredText = (storageKey: string, text: string | null): void => {
    try {
      if (text === null) {
        storageOf().removeItem(storageKey);
        return;
      }
      storageOf().setItem(storageKey, text);
    } catch {
      // The page works without persistence.
    }
  };

  const writeStoredChoice = (storageKey: string, choice: string, defaultChoice: string): void => {
    writeStoredText(storageKey, choice === defaultChoice ? null : choice);
  };

  const readStoredOverride = (): StoredViewOverride => {
    const stored = readStoredChoice(rangeOverrideStorageKeyFor(trackerId));
    try {
      return stored === null ? EMPTY_VIEW_OVERRIDE : storedOverrideFrom(JSON.parse(stored));
    } catch {
      return EMPTY_VIEW_OVERRIDE;
    }
  };

  const writeStoredOverride = (override: StoredViewOverride): void => {
    writeStoredText(rangeOverrideStorageKeyFor(trackerId), overrideIsEmpty(override) ? null : JSON.stringify(override));
  };

  return {
    readRangeOverride:         readStoredOverride,
    writeRangeOverride:        writeStoredOverride,
    readWorkVisibility:        () => workVisibilityFrom(readStoredChoice(workVisibilityStorageKeyFor(trackerId))),
    writeWorkVisibility:       (visibility) => writeStoredChoice(workVisibilityStorageKeyFor(trackerId), visibility, DEFAULT_WORK_VISIBILITY),
    readLogVisibility:         () => logVisibilityFrom(readStoredChoice(logVisibilityStorageKeyFor(trackerId))),
    writeLogVisibility:        (visibility) => writeStoredChoice(logVisibilityStorageKeyFor(trackerId), visibility, DEFAULT_LOG_VISIBILITY),
    readNameColumnWidth:       () => nameColumnWidthFrom(readStoredChoice(nameColumnWidthStorageKeyFor(trackerId))),
    writeNameColumnWidth:      (width) => writeStoredChoice(nameColumnWidthStorageKeyFor(trackerId), width, DEFAULT_NAME_COLUMN_WIDTH),
    readAbandonedLaneIsOpen:   () => abandonedLaneIsOpenFrom(readStoredChoice(abandonedLaneStorageKeyFor(trackerId))),
    writeAbandonedLaneIsOpen:  (laneIsOpen) => writeStoredChoice(abandonedLaneStorageKeyFor(trackerId), abandonedLaneChoiceFor(laneIsOpen), DEFAULT_ABANDONED_LANE_CHOICE),
    readCappedLaneShownCount:  (lane) => shownCountFrom(readStoredChoice(cappedLaneStorageKeyFor(trackerId, lane))),
    writeCappedLaneShownCount: (lane, shownCount) => writeStoredChoice(cappedLaneStorageKeyFor(trackerId, lane), String(shownCount), String(CAPPED_LANE_FIRST_PAGE)),
  };
}
