/**
 * The spec Tickets tab's search and chip filters as pure functions over the snapshot's work items: the rows in their order, the text a
 * search reads, which rows a view shows, and what each spec and state chip would show.
 */

import type { SnapshotSpec, SpecSnapshot, WorkItem } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { WorkItemState }                        from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import { WORK_ITEM_STATES }                          from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { ChipFilter }                           from '../../chips/ChipFilterUtil.ts';
import { ChipFilterUtil }                            from '../../chips/ChipFilterUtil.ts';
import { SearchMarkUtil }                            from '../../tickets/utils/SearchMarkUtil.ts';
import { SpecGroupMarks }                            from '../marks/SpecGroupMarks.ts';

export interface SpecWorkItemEntry {
  readonly spec:     SnapshotSpec;
  readonly workItem: WorkItem;
}

export interface SpecTicketsView {
  readonly searchText: string;
  /** Spec folder names. */
  readonly specChips:  readonly string[];
  readonly stateChips: readonly WorkItemState[];
}

export const DEFAULT_SPEC_TICKETS_VIEW: SpecTicketsView = Object.freeze({ searchText: '', specChips: [], stateChips: [] });

interface SpecTicketsChipFilters {
  spec:  ChipFilter<SpecWorkItemEntry>;
  state: ChipFilter<SpecWorkItemEntry, WorkItemState>;
  all:   ReadonlyArray<ChipFilter<SpecWorkItemEntry>>;
}

/** Specs in snapshot order, each spec's rows in `tasks.md` phase order. */
function workItemEntriesOf(snapshot: SpecSnapshot): SpecWorkItemEntry[] {
  return snapshot.specs.flatMap((spec) => spec.workItems.toSorted((a, b) => a.ordinal - b.ordinal).map((workItem) => ({ spec, workItem })));
}

/** Built once per row, since a search re-reads it on every keystroke. */
function searchableTextOf(entry: SpecWorkItemEntry): string {
  const { spec, workItem } = entry;
  return [workItem.title, SpecGroupMarks.phaseTagTextOf(workItem), spec.folderName, spec.number === null ? '' : String(spec.number), spec.title]
    .join('\n')
    .toLowerCase();
}

function chipFiltersOf(view: SpecTicketsView): SpecTicketsChipFilters {
  const spec: ChipFilter<SpecWorkItemEntry>                   = { pressed: view.specChips, chipsOf: (entry) => [entry.spec.folderName] };
  const state: ChipFilter<SpecWorkItemEntry, WorkItemState> = { pressed: view.stateChips, chipsOf: (entry) => [entry.workItem.state] };
  return { spec, state, all: [spec, state] };
}

function searchMatcherOf(view: SpecTicketsView, searchableTextById: ReadonlyMap<string, string>): (entry: SpecWorkItemEntry) => boolean {
  const query = SearchMarkUtil.normalisedQueryOf(view.searchText);
  return (entry) => query === '' || (searchableTextById.get(entry.workItem.id) ?? '').includes(query);
}

function viewNarrows(view: SpecTicketsView): boolean {
  return SearchMarkUtil.normalisedQueryOf(view.searchText) !== '' || view.specChips.length > 0 || view.stateChips.length > 0;
}

function entriesShownBy(view: SpecTicketsView, entries: readonly SpecWorkItemEntry[], searchableTextById: ReadonlyMap<string, string>): SpecWorkItemEntry[] {
  const searchMatches = searchMatcherOf(view, searchableTextById);
  const filters       = chipFiltersOf(view);
  return entries.filter((entry) => ChipFilterUtil.itemMatches(entry, searchMatches, filters.all));
}

function specChipCountsOf(view: SpecTicketsView, entries: readonly SpecWorkItemEntry[], searchableTextById: ReadonlyMap<string, string>): Map<string, number> {
  const filters = chipFiltersOf(view);
  return ChipFilterUtil.chipCountsOf(entries, searchMatcherOf(view, searchableTextById), filters.all, filters.spec);
}

function stateChipCountsOf(view: SpecTicketsView, entries: readonly SpecWorkItemEntry[], searchableTextById: ReadonlyMap<string, string>): Map<WorkItemState, number> {
  const filters = chipFiltersOf(view);
  return ChipFilterUtil.chipCountsOf(entries, searchMatcherOf(view, searchableTextById), filters.all, filters.state, WORK_ITEM_STATES);
}

export const SpecWorkItemViewUtil = Object.freeze({
  workItemEntriesOf,
  searchableTextOf,
  viewNarrows,
  entriesShownBy,
  specChipCountsOf,
  stateChipCountsOf,
});
