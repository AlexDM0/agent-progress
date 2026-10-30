/**
 * The Progress chart's choices kept per viewer and board, under the static page's keys so a viewer's choices carry over: the range as
 * JSON under the bare `<STORAGE_PREFIX>:<trackerId>`, then `name-column`, `progress-folded-epics` and `review-rows` after it. Without a
 * board store, before the Overseer named its tracker, every choice reads as its default and nothing is written.
 */
import type { PreferenceStore }                                                          from '../../preferences/PreferenceStore.ts';
import { FOLDED_EPIC_GROUPS_CHOICE_NAME }                                                from './EpicRowGrouping.ts';
import { DEFAULT_REVIEW_ROWS_CHOICE, REVIEW_ROWS_CHOICE_NAME, REVIEW_ROWS_SHOWN_CHOICE } from './ProgressModel.ts';
import {
  ChartPreferenceUtil,
  DEFAULT_NAME_COLUMN_WIDTH,
  EMPTY_VIEW_OVERRIDE,
  type NameColumnWidth,
  type StoredViewOverride
} from './utils/ChartPreferenceUtil.ts';

const NAME_COLUMN_WIDTH_CHOICE_NAME = 'name-column';

export interface ProgressPreferences {
  readonly readRangeOverride:       () => StoredViewOverride;
  readonly writeRangeOverride:      (override: StoredViewOverride) => void;
  readonly readNameColumnWidth:     () => NameColumnWidth;
  readonly writeNameColumnWidth:    (width: NameColumnWidth) => void;
  readonly readFoldedEpicGroups:    () => string[];
  readonly writeFoldedEpicGroups:   (foldedGroupKeys: readonly string[]) => void;
  readonly readReviewRowsAreShown:  () => boolean;
  readonly writeReviewRowsAreShown: (reviewRowsAreShown: boolean) => void;
}

export function progressPreferencesOf(store: PreferenceStore | null): ProgressPreferences {
  return {
    readRangeOverride:       () => (store === null ? EMPTY_VIEW_OVERRIDE : ChartPreferenceUtil.storedOverrideFromText(store.readText())),
    writeRangeOverride:      (override) => store?.writeText(ChartPreferenceUtil.storedTextOfOverride(override)),
    readNameColumnWidth:     () => ChartPreferenceUtil.nameColumnWidthFrom(store?.readChoice(NAME_COLUMN_WIDTH_CHOICE_NAME) ?? null),
    writeNameColumnWidth:    (width) => store?.writeChoice(NAME_COLUMN_WIDTH_CHOICE_NAME, width, DEFAULT_NAME_COLUMN_WIDTH),
    readFoldedEpicGroups:    () => store?.readTextList(FOLDED_EPIC_GROUPS_CHOICE_NAME) ?? [],
    writeFoldedEpicGroups:   (foldedGroupKeys) => store?.writeTextList(FOLDED_EPIC_GROUPS_CHOICE_NAME, foldedGroupKeys),
    readReviewRowsAreShown:  () => store?.readChoice(REVIEW_ROWS_CHOICE_NAME) === REVIEW_ROWS_SHOWN_CHOICE,
    writeReviewRowsAreShown: (reviewRowsAreShown) => store?.writeChoice(
      REVIEW_ROWS_CHOICE_NAME,
      reviewRowsAreShown ? REVIEW_ROWS_SHOWN_CHOICE : DEFAULT_REVIEW_ROWS_CHOICE,
      DEFAULT_REVIEW_ROWS_CHOICE,
    ),
  };
}
