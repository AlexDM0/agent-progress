/**
 * The viewer's stored page choices and the reload snapshot: the key strings and the reads and writes. The one module where the page script
 * touches browser storage; the template's bootstrap keeps its own theme and tab keys.
 */

import type {
  PreferenceStorage,
  ReloadSnapshotStore,
  StoredViewOverride,
  ViewerPreferences,
} from '../@types/ViewerChoices.ts';
import type { ClosedKanbanLane }        from '../kanban/constants/KanbanBoardLayout.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS } from '../kanban/constants/KanbanBoardLayout.ts';
import { DEFAULT_FINISHED_WORK_CHOICE } from '../utils/FinishedWorkUtil.ts';
import { JsonValueUtil }                from '../utils/JsonValueUtil.ts';
import {
  DEFAULT_ABANDONED_LANE_CHOICE,
  DEFAULT_NAME_COLUMN_WIDTH,
  DEFAULT_REVIEW_ROWS_CHOICE,
  DEFAULT_TICKET_GROUPING_CHOICE,
} from './constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE }  from './constants/ViewOverride.ts';
import { ViewerPreferenceUtil } from './utils/ViewerPreferenceUtil.ts';

const REVIEW_ROWS_SHOWN_CHOICE = 'rows';

const TICKETS_GROUPED_BY_EPIC_CHOICE = 'epic';

// A literal map rather than the lane value, so renaming a lane cannot move a viewer's stored key.
const CAPPED_LANE_KEY_SUFFIX: Readonly<Record<ClosedKanbanLane, string>> = {
  done:      'kanban-done-shown',
  abandoned: 'kanban-abandoned-shown',
};

// Session storage is one tab's, so it needs no tracker id: the snapshot carries it instead, for a tab that opens another dashboard.
const RELOAD_SNAPSHOT_STORAGE_KEY = 'agent-progress:snapshot';

/** `file://` is one origin in Chrome, so the tracker id is what keeps two dashboards' ranges apart. */
function rangeOverrideStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}`;
}

/** Every other choice's key is the range key plus the choice's own name. */
function choiceStorageKeyFor(trackerId: string, choiceName: string): string {
  return `${rangeOverrideStorageKeyFor(trackerId)}:${choiceName}`;
}

// The hide-finished checkbox's key, kept so a viewer's `recent` and `all` still read.
function finishedWorkChoiceStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'visibility');
}

function nameColumnWidthStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'name-column');
}

function reviewRowsStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'review-rows');
}

function abandonedLaneStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'kanban-abandoned');
}

function cappedLaneStorageKeyFor(trackerId: string, lane: ClosedKanbanLane): string {
  return choiceStorageKeyFor(trackerId, CAPPED_LANE_KEY_SUFFIX[lane]);
}

function ticketGroupingStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'ticket-grouping');
}

function kanbanEpicFilterStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'kanban-epics');
}

function foldedEpicGroupsStorageKeyFor(trackerId: string): string {
  return choiceStorageKeyFor(trackerId, 'progress-folded-epics');
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

  const readStoredTextList = (storageKey: string): string[] => {
    try {
      return JsonValueUtil.textListOf(JSON.parse(readStoredChoice(storageKey) ?? '[]'));
    } catch {
      return [];
    }
  };

  /** An empty list removes the key. */
  const writeStoredTextList = (storageKey: string, texts: readonly string[]): void => {
    writeStoredText(storageKey, texts.length === 0 ? null : JSON.stringify(texts));
  };

  const readStoredOverride = (): StoredViewOverride => {
    const stored = readStoredChoice(rangeOverrideStorageKeyFor(trackerId));
    try {
      return stored === null ? EMPTY_VIEW_OVERRIDE : ViewerPreferenceUtil.storedOverrideFrom(JSON.parse(stored));
    } catch {
      return EMPTY_VIEW_OVERRIDE;
    }
  };

  const writeStoredOverride = (override: StoredViewOverride): void => {
    writeStoredText(rangeOverrideStorageKeyFor(trackerId), ViewerPreferenceUtil.overrideIsEmpty(override) ? null : JSON.stringify(override));
  };

  return {
    readRangeOverride:       readStoredOverride,
    writeRangeOverride:      writeStoredOverride,
    readFinishedWorkChoice:  () => ViewerPreferenceUtil.finishedWorkChoiceFrom(readStoredChoice(finishedWorkChoiceStorageKeyFor(trackerId))),
    writeFinishedWorkChoice: (choice) => writeStoredChoice(finishedWorkChoiceStorageKeyFor(trackerId), choice, DEFAULT_FINISHED_WORK_CHOICE),
    readNameColumnWidth:     () => ViewerPreferenceUtil.nameColumnWidthFrom(readStoredChoice(nameColumnWidthStorageKeyFor(trackerId))),
    writeNameColumnWidth:    (width) => writeStoredChoice(nameColumnWidthStorageKeyFor(trackerId), width, DEFAULT_NAME_COLUMN_WIDTH),
    readReviewRowsAreShown:  () => readStoredChoice(reviewRowsStorageKeyFor(trackerId)) === REVIEW_ROWS_SHOWN_CHOICE,
    writeReviewRowsAreShown: (reviewRowsAreShown) => writeStoredChoice(
      reviewRowsStorageKeyFor(trackerId),
      reviewRowsAreShown ? REVIEW_ROWS_SHOWN_CHOICE : DEFAULT_REVIEW_ROWS_CHOICE,
      DEFAULT_REVIEW_ROWS_CHOICE,
    ),
    readAbandonedLaneIsOpen:  () => ViewerPreferenceUtil.abandonedLaneIsOpenFrom(readStoredChoice(abandonedLaneStorageKeyFor(trackerId))),
    writeAbandonedLaneIsOpen: (laneIsOpen) => writeStoredChoice(
      abandonedLaneStorageKeyFor(trackerId),
      ViewerPreferenceUtil.abandonedLaneChoiceFor(laneIsOpen),
      DEFAULT_ABANDONED_LANE_CHOICE,
    ),
    readCappedLaneShownCount:  (lane) => ViewerPreferenceUtil.shownCountFrom(readStoredChoice(cappedLaneStorageKeyFor(trackerId, lane))),
    writeCappedLaneShownCount: (lane, shownCount) => writeStoredChoice(
      cappedLaneStorageKeyFor(trackerId, lane),
      String(shownCount),
      String(CAPPED_LANE_FIRST_PAGE_CARDS),
    ),
    readTicketsGroupedByEpic:  () => readStoredChoice(ticketGroupingStorageKeyFor(trackerId)) === TICKETS_GROUPED_BY_EPIC_CHOICE,
    writeTicketsGroupedByEpic: (ticketsAreGrouped) => writeStoredChoice(
      ticketGroupingStorageKeyFor(trackerId),
      ticketsAreGrouped ? TICKETS_GROUPED_BY_EPIC_CHOICE : DEFAULT_TICKET_GROUPING_CHOICE,
      DEFAULT_TICKET_GROUPING_CHOICE,
    ),
    readKanbanEpicFilter:  () => readStoredTextList(kanbanEpicFilterStorageKeyFor(trackerId)),
    writeKanbanEpicFilter: (pressedChips) => writeStoredTextList(kanbanEpicFilterStorageKeyFor(trackerId), pressedChips),
    readFoldedEpicGroups:  () => readStoredTextList(foldedEpicGroupsStorageKeyFor(trackerId)),
    writeFoldedEpicGroups: (foldedGroupKeys) => writeStoredTextList(foldedEpicGroupsStorageKeyFor(trackerId), foldedGroupKeys),
  };
}

/** The place kept across one idle reload, in the tab's session storage; `take` deletes it, so it is restored once and never outlives the reload. */
export function createReloadSnapshotStore(trackerId: string, storageOf: () => PreferenceStorage): ReloadSnapshotStore {
  return {
    write: (snapshot) => {
      try {
        storageOf().setItem(RELOAD_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // The reload still happens, only without the place.
      }
    },
    take: () => {
      try {
        const stored = storageOf().getItem(RELOAD_SNAPSHOT_STORAGE_KEY);
        if (stored === null) {
          return null;
        }
        storageOf().removeItem(RELOAD_SNAPSHOT_STORAGE_KEY);
        return ViewerPreferenceUtil.reloadSnapshotFrom(JSON.parse(stored), trackerId);
      } catch {
        return null;
      }
    },
  };
}
