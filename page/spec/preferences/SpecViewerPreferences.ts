/**
 * The spec page's stored choices, kept per repository over the preference store: which specs the Kanban's strip narrows the work band to,
 * and the Tickets tab's search and pressed chips.
 */

import { WORK_ITEM_STATES }       from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { PreferenceStorage } from '../../@types/ViewerChoices.ts';
import { ChipFilterUtil }         from '../../chips/ChipFilterUtil.ts';
import { createPreferenceStore }  from '../../preferences/PreferenceStore.ts';
import type { SpecTicketsView }   from '../tickets/SpecWorkItemViewUtil.ts';

const KANBAN_SPEC_FILTER_CHOICE_NAME  = 'kanban-specs';
const TICKETS_SEARCH_CHOICE_NAME      = 'tickets-search';
const TICKETS_SPEC_FILTER_CHOICE_NAME = 'tickets-specs';
const TICKETS_STATE_FILTER_CHOICE_NAME = 'tickets-states';

export interface SpecViewerPreferences {
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
  return {
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
