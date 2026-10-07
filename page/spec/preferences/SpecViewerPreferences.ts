/** The spec page's stored choices, kept per repository over the preference store: which specs the Kanban's strip narrows the work band to. */

import type { PreferenceStorage } from '../../@types/ViewerChoices.ts';
import { createPreferenceStore }  from '../../preferences/PreferenceStore.ts';

const KANBAN_SPEC_FILTER_CHOICE_NAME = 'kanban-specs';

export interface SpecViewerPreferences {
  /** The spec folder names whose chips were pressed, in the order they were pressed. */
  readKanbanSpecFilter(): string[];
  writeKanbanSpecFilter(specKeys: readonly string[]): void;
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
  };
}
