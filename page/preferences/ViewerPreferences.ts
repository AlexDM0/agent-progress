/**
 * The tracker page's stored choices and the reload snapshot: their key strings and what each reads and writes, over the preference store.
 * The template's bootstrap keeps its own theme and tab keys.
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
import { createPreferenceStore }        from './PreferenceStore.ts';
import {
  DEFAULT_ABANDONED_LANE_CHOICE,
  DEFAULT_NAME_COLUMN_WIDTH,
  DEFAULT_REVIEW_ROWS_CHOICE,
  DEFAULT_TICKET_GROUPING_CHOICE,
  DEFAULT_TODO_ORDER_CHOICE,
} from './constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE }  from './constants/ViewOverride.ts';
import { ViewerPreferenceUtil } from './utils/ViewerPreferenceUtil.ts';

const REVIEW_ROWS_SHOWN_CHOICE = 'rows';

const TICKETS_GROUPED_BY_EPIC_CHOICE = 'epic';

const TODO_ORDER_BY_WAVE_CHOICE = 'by-wave';

// A literal map rather than the lane value, so renaming a lane cannot move a viewer's stored key.
const CAPPED_LANE_KEY_SUFFIX: Readonly<Record<ClosedKanbanLane, string>> = {
  done:      'kanban-done-shown',
  abandoned: 'kanban-abandoned-shown',
};

// Session storage is one tab's, so it needs no tracker id: the snapshot carries it instead, for a tab that opens another dashboard.
const RELOAD_SNAPSHOT_STORAGE_KEY = 'agent-progress:snapshot';

/** `file://` is one origin in Chrome, so the tracker id is what keeps two dashboards' ranges apart; the range is stored under the bare prefix. */
function preferenceKeyPrefixFor(trackerId: string): string {
  return `agent-progress:${trackerId}`;
}

// Every other choice's key is the prefix plus one of these names; the finished-work choice keeps the hide-finished checkbox's key,
// so a viewer's `recent` and `all` still read.
const FINISHED_WORK_CHOICE_NAME      = 'visibility';
const NAME_COLUMN_WIDTH_CHOICE_NAME  = 'name-column';
const REVIEW_ROWS_CHOICE_NAME        = 'review-rows';
const ABANDONED_LANE_CHOICE_NAME     = 'kanban-abandoned';
const TICKET_GROUPING_CHOICE_NAME    = 'ticket-grouping';
const KANBAN_EPIC_FILTER_CHOICE_NAME = 'kanban-epics';
const TODO_ORDER_CHOICE_NAME         = 'kanban-todo-order';
const FOLDED_EPIC_GROUPS_CHOICE_NAME = 'progress-folded-epics';

export function createViewerPreferences(trackerId: string, storageOf: () => PreferenceStorage): ViewerPreferences {
  const store = createPreferenceStore(preferenceKeyPrefixFor(trackerId), storageOf);

  const readStoredOverride = (): StoredViewOverride => {
    const stored = store.readText();
    try {
      return stored === null ? EMPTY_VIEW_OVERRIDE : ViewerPreferenceUtil.storedOverrideFrom(JSON.parse(stored));
    } catch {
      return EMPTY_VIEW_OVERRIDE;
    }
  };

  const writeStoredOverride = (override: StoredViewOverride): void => {
    store.writeText(ViewerPreferenceUtil.overrideIsEmpty(override) ? null : JSON.stringify(override));
  };

  return {
    readRangeOverride:       readStoredOverride,
    writeRangeOverride:      writeStoredOverride,
    readFinishedWorkChoice:  () => ViewerPreferenceUtil.finishedWorkChoiceFrom(store.readChoice(FINISHED_WORK_CHOICE_NAME)),
    writeFinishedWorkChoice: (choice) => store.writeChoice(FINISHED_WORK_CHOICE_NAME, choice, DEFAULT_FINISHED_WORK_CHOICE),
    readNameColumnWidth:     () => ViewerPreferenceUtil.nameColumnWidthFrom(store.readChoice(NAME_COLUMN_WIDTH_CHOICE_NAME)),
    writeNameColumnWidth:    (width) => store.writeChoice(NAME_COLUMN_WIDTH_CHOICE_NAME, width, DEFAULT_NAME_COLUMN_WIDTH),
    readReviewRowsAreShown:  () => store.readChoice(REVIEW_ROWS_CHOICE_NAME) === REVIEW_ROWS_SHOWN_CHOICE,
    writeReviewRowsAreShown: (reviewRowsAreShown) => store.writeChoice(
      REVIEW_ROWS_CHOICE_NAME,
      reviewRowsAreShown ? REVIEW_ROWS_SHOWN_CHOICE : DEFAULT_REVIEW_ROWS_CHOICE,
      DEFAULT_REVIEW_ROWS_CHOICE,
    ),
    readAbandonedLaneIsOpen:  () => ViewerPreferenceUtil.abandonedLaneIsOpenFrom(store.readChoice(ABANDONED_LANE_CHOICE_NAME)),
    writeAbandonedLaneIsOpen: (laneIsOpen) => store.writeChoice(
      ABANDONED_LANE_CHOICE_NAME,
      ViewerPreferenceUtil.abandonedLaneChoiceFor(laneIsOpen),
      DEFAULT_ABANDONED_LANE_CHOICE,
    ),
    readCappedLaneShownCount:  (lane) => ViewerPreferenceUtil.shownCountFrom(store.readChoice(CAPPED_LANE_KEY_SUFFIX[lane])),
    writeCappedLaneShownCount: (lane, shownCount) => store.writeChoice(
      CAPPED_LANE_KEY_SUFFIX[lane],
      String(shownCount),
      String(CAPPED_LANE_FIRST_PAGE_CARDS),
    ),
    readTicketsGroupedByEpic:  () => store.readChoice(TICKET_GROUPING_CHOICE_NAME) === TICKETS_GROUPED_BY_EPIC_CHOICE,
    writeTicketsGroupedByEpic: (ticketsAreGrouped) => store.writeChoice(
      TICKET_GROUPING_CHOICE_NAME,
      ticketsAreGrouped ? TICKETS_GROUPED_BY_EPIC_CHOICE : DEFAULT_TICKET_GROUPING_CHOICE,
      DEFAULT_TICKET_GROUPING_CHOICE,
    ),
    readKanbanEpicFilter:  () => store.readTextList(KANBAN_EPIC_FILTER_CHOICE_NAME),
    writeKanbanEpicFilter: (pressedChips) => store.writeTextList(KANBAN_EPIC_FILTER_CHOICE_NAME, pressedChips),
    readTodoOrder:         () => (store.readChoice(TODO_ORDER_CHOICE_NAME) === TODO_ORDER_BY_WAVE_CHOICE ? 'by-wave' : DEFAULT_TODO_ORDER_CHOICE),
    writeTodoOrder:        (order) => store.writeChoice(TODO_ORDER_CHOICE_NAME, order, DEFAULT_TODO_ORDER_CHOICE),
    readFoldedEpicGroups:  () => store.readTextList(FOLDED_EPIC_GROUPS_CHOICE_NAME),
    writeFoldedEpicGroups: (foldedGroupKeys) => store.writeTextList(FOLDED_EPIC_GROUPS_CHOICE_NAME, foldedGroupKeys),
  };
}

/** The place kept across one idle reload, in the tab's session storage; `take` deletes it, so it is restored once and never outlives the reload. */
export function createReloadSnapshotStore(trackerId: string, storageOf: () => PreferenceStorage): ReloadSnapshotStore {
  const store = createPreferenceStore(RELOAD_SNAPSHOT_STORAGE_KEY, storageOf);
  return {
    write: (snapshot) => store.writeText(JSON.stringify(snapshot)),
    take:  () => {
      const stored = store.readText();
      if (stored === null) {
        return null;
      }
      store.writeText(null);
      try {
        return ViewerPreferenceUtil.reloadSnapshotFrom(JSON.parse(stored), trackerId);
      } catch {
        return null;
      }
    },
  };
}
