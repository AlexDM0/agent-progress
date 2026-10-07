/**
 * The spec page's Tickets tab: every work item grouped by spec, narrowed by the search and the spec and state chips, with their counts,
 * the choices kept per repository. A row carries its work item's id, so the detail panel opens it.
 */

import type { SpecSnapshot }                            from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { WORK_ITEM_STATES }                             from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import { ChipFilterUtil }                               from '../../chips/ChipFilterUtil.ts';
import { createChipGroupController }                    from '../../chips/ChipGroupController.ts';
import { createSearchInputController }                  from '../../tickets/SearchInputController.ts';
import { DomUtil }                                      from '../../utils/DomUtil.ts';
import { SPEC_MARK_VOCABULARY }                         from '../constants/SpecMarkVocabulary.ts';
import { SpecGroupMarks }                               from '../marks/SpecGroupMarks.ts';
import type { SpecViewerPreferences }                   from '../preferences/SpecViewerPreferences.ts';
import { SpecTicketsMarkup, WORK_STATE_CHIP_ATTRIBUTE } from './SpecTicketsMarkup.ts';
import type { SpecTicketsView }                         from './SpecWorkItemViewUtil.ts';
import { SpecWorkItemViewUtil }                         from './SpecWorkItemViewUtil.ts';

const TICKETS_PANEL_ELEMENT_ID      = 'ap-panel-tickets';
const TICKET_ROWS_ELEMENT_ID        = 'ap-spec-tickets';
const TICKET_SEARCH_ELEMENT_ID      = 'ap-spec-ticket-search';
const TICKET_SPEC_CHIPS_ELEMENT_ID  = 'ap-spec-ticket-specs';
const TICKET_STATE_CHIPS_ELEMENT_ID = 'ap-spec-ticket-states';
const TICKET_CLEAR_ELEMENT_ID       = 'ap-spec-ticket-clear';
const TICKET_COUNT_ELEMENT_ID       = 'ap-spec-ticket-count';

/** The ids the page clears before filling. */
export const SPEC_TICKETS_MARKUP_CONTAINER_IDS = [TICKET_ROWS_ELEMENT_ID, TICKET_SPEC_CHIPS_ELEMENT_ID, TICKET_STATE_CHIPS_ELEMENT_ID];
export const SPEC_TICKETS_TEXT_CONTAINER_IDS   = [TICKET_COUNT_ELEMENT_ID];

interface SpecTicketsSources {
  snapshot:    SpecSnapshot;
  preferences: SpecViewerPreferences;
}

export interface SpecTicketsController {
  wire(): void;
}

export function createSpecTicketsController(sources: SpecTicketsSources): SpecTicketsController {
  const { snapshot, preferences } = sources;
  const entries            = SpecWorkItemViewUtil.workItemEntriesOf(snapshot);
  const searchableTextById = new Map(entries.map((entry) => [entry.workItem.id, SpecWorkItemViewUtil.searchableTextOf(entry)]));
  const specLabelByKey     = new Map(snapshot.specs.map((spec) => [spec.folderName, SpecGroupMarks.specMarkOf(spec).title]));
  const specLabelOf        = (specKey: string): string => specLabelByKey.get(specKey) ?? specKey;
  const specChipGroup      = createChipGroupController({ containerId: TICKET_SPEC_CHIPS_ELEMENT_ID, attributeName: SPEC_MARK_VOCABULARY.filterChipAttribute });
  const stateChipGroup     = createChipGroupController({ containerId: TICKET_STATE_CHIPS_ELEMENT_ID, attributeName: WORK_STATE_CHIP_ATTRIBUTE });
  const searchInput        = createSearchInputController(TICKET_SEARCH_ELEMENT_ID);
  let view: SpecTicketsView = preferences.readTicketsView(new Set(specLabelByKey.keys()));

  const render = (): void => {
    const shown   = SpecWorkItemViewUtil.entriesShownBy(view, entries, searchableTextById);
    const narrows = SpecWorkItemViewUtil.viewNarrows(view);
    DomUtil.setMarkup(TICKET_ROWS_ELEMENT_ID, shown.length === 0
      ? SpecTicketsMarkup.emptySpecTicketTableMarkup(view, narrows, specLabelOf)
      : SpecTicketsMarkup.specTicketRowsMarkup(shown, entries, view.searchText));
    DomUtil.setText(TICKET_COUNT_ELEMENT_ID, SpecTicketsMarkup.workItemCountText(shown.length, entries.length));
    specChipGroup.reflect(view.specChips, SpecWorkItemViewUtil.specChipCountsOf(view, entries, searchableTextById));
    stateChipGroup.reflect(view.stateChips, SpecWorkItemViewUtil.stateChipCountsOf(view, entries, searchableTextById));
    DomUtil.setHidden(TICKET_CLEAR_ELEMENT_ID, !narrows);
    searchInput.reflect(view.searchText);
  };

  const changeView = (changedView: SpecTicketsView): void => {
    view = changedView;
    preferences.writeTicketsView(view);
    render();
  };

  const clearSearchAndFilters = (): void => {
    changeView({ searchText: '', specChips: [], stateChips: [] });
    searchInput.focus();
  };

  return {
    wire: () => {
      DomUtil.setMarkup(TICKET_SPEC_CHIPS_ELEMENT_ID, SpecTicketsMarkup.specChipsMarkup(snapshot.specs));
      DomUtil.setMarkup(TICKET_STATE_CHIPS_ELEMENT_ID, SpecTicketsMarkup.stateChipsMarkup(WORK_ITEM_STATES));
      searchInput.wire((searchText) => changeView({ ...view, searchText }));
      specChipGroup.wire((specKey) => changeView({ ...view, specChips: ChipFilterUtil.toggledChips(view.specChips, specKey) }));
      stateChipGroup.wire((value) => {
        const state = WORK_ITEM_STATES.find((candidate) => candidate === value);
        if (state !== undefined) {
          changeView({ ...view, stateChips: view.stateChips.includes(state) ? view.stateChips.filter((pressed) => pressed !== state) : [...view.stateChips, state] });
        }
      });
      document.getElementById(TICKET_CLEAR_ELEMENT_ID)?.addEventListener('click', clearSearchAndFilters);
      document.getElementById(TICKETS_PANEL_ELEMENT_ID)?.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-clear-filters]') !== null) {
          clearSearchAndFilters();
        }
      });
      render();
    },
  };
}
