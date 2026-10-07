/**
 * The spec page's stored choices, kept per repository over the preference store: which specs the Kanban's strip narrows the work band to,
 * the Tickets tab's search and pressed chips, and the Progress chart's range, name column and folded groups.
 */

import { WORK_ITEM_STATES }                           from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { PreferenceStorage, StoredViewOverride } from '../../@types/ViewerChoices.ts';
import { ChipFilterUtil }                             from '../../chips/ChipFilterUtil.ts';
import { createPreferenceStore }                      from '../../preferences/PreferenceStore.ts';
import { DEFAULT_NAME_COLUMN_WIDTH }                  from '../../preferences/constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE }                        from '../../preferences/constants/ViewOverride.ts';
import type { GanttChartPreferences }                 from '../../progress/GanttChartController.ts';
import { ChartPreferenceUtil }                        from '../../progress/utils/ChartPreferenceUtil.ts';
import type { SpecTicketsView }                       from '../tickets/SpecWorkItemViewUtil.ts';

const KANBAN_SPEC_FILTER_CHOICE_NAME  = 'kanban-specs';
const TICKETS_SEARCH_CHOICE_NAME      = 'tickets-search';
const TICKETS_SPEC_FILTER_CHOICE_NAME = 'tickets-specs';
const TICKETS_STATE_FILTER_CHOICE_NAME = 'tickets-states';
const PROGRESS_RANGE_CHOICE_NAME       = 'progress-range';
const PROGRESS_NAME_COLUMN_CHOICE_NAME = 'progress-name-column';
const PROGRESS_FOLDED_GROUPS_CHOICE_NAME = 'progress-folded-groups';

/** The empty override is stored by removing the key. */
const NO_STORED_RANGE = '';

/** The chart's choices each sit under a name below the spec page's prefix, so none can land on a tracker page's bare range key. */
export interface SpecViewerPreferences extends GanttChartPreferences {
  /** The spec folder names whose chips were pressed, in the order they were pressed. */
  readKanbanSpecFilter(): string[];
  writeKanbanSpecFilter(specKeys: readonly string[]): void;
  /** A stored spec chip whose spec is gone, or a state no work item has, presses nothing. */
  readTicketsView(knownSpecKeys: ReadonlySet<string>): SpecTicketsView;
  writeTicketsView(view: SpecTicketsView): void;
}

/** `file://` is one origin in Chrome, so the repository key is what keeps two repositories' spec pages apart. */
function preferenceKeyPrefixFor(repositoryKey: string): string {
  return `agent-progress-spec:${repositoryKey}`;
}

export function createSpecViewerPreferences(repositoryKey: string, storageOf: () => PreferenceStorage): SpecViewerPreferences {
  const store = createPreferenceStore(preferenceKeyPrefixFor(repositoryKey), storageOf);

  const readRangeOverride = (): StoredViewOverride => {
    const stored = store.readChoice(PROGRESS_RANGE_CHOICE_NAME);
    try {
      return stored === null ? EMPTY_VIEW_OVERRIDE : ChartPreferenceUtil.storedOverrideFrom(JSON.parse(stored));
    } catch {
      return EMPTY_VIEW_OVERRIDE;
    }
  };

  return {
    readRangeOverride,
    writeRangeOverride: (override) => store.writeChoice(
      PROGRESS_RANGE_CHOICE_NAME,
      ChartPreferenceUtil.overrideIsEmpty(override) ? NO_STORED_RANGE : JSON.stringify(override),
      NO_STORED_RANGE,
    ),
    readNameColumnWidth:   () => ChartPreferenceUtil.nameColumnWidthFrom(store.readChoice(PROGRESS_NAME_COLUMN_CHOICE_NAME)),
    writeNameColumnWidth:  (width) => store.writeChoice(PROGRESS_NAME_COLUMN_CHOICE_NAME, width, DEFAULT_NAME_COLUMN_WIDTH),
    readFoldedEpicGroups:  () => store.readTextList(PROGRESS_FOLDED_GROUPS_CHOICE_NAME),
    writeFoldedEpicGroups: (foldedGroupKeys) => store.writeTextList(PROGRESS_FOLDED_GROUPS_CHOICE_NAME, foldedGroupKeys),
    readKanbanSpecFilter:  () => store.readTextList(KANBAN_SPEC_FILTER_CHOICE_NAME),
    writeKanbanSpecFilter: (specKeys) => store.writeTextList(KANBAN_SPEC_FILTER_CHOICE_NAME, specKeys),
    readTicketsView:       (knownSpecKeys) => {
      const storedStates = store.readTextList(TICKETS_STATE_FILTER_CHOICE_NAME);
      return {
        searchText: store.readChoice(TICKETS_SEARCH_CHOICE_NAME) ?? '',
        specChips:  ChipFilterUtil.knownPressedChips(store.readTextList(TICKETS_SPEC_FILTER_CHOICE_NAME), knownSpecKeys),
        stateChips: WORK_ITEM_STATES.filter((state) => storedStates.includes(state)),
      };
    },
    writeTicketsView: (view) => {
      store.writeChoice(TICKETS_SEARCH_CHOICE_NAME, view.searchText, '');
      store.writeTextList(TICKETS_SPEC_FILTER_CHOICE_NAME, view.specChips);
      store.writeTextList(TICKETS_STATE_FILTER_CHOICE_NAME, view.stateChips);
    },
  };
}
