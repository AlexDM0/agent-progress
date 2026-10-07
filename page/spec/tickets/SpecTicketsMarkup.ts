/**
 * The spec Tickets tab's markup: one row per work item under its spec's group row, the search's matches marked, the empty row, the spec and
 * state chips and the count. Every snapshot value passes `escapeHtml` exactly once, here or in the shared renderer it is handed to.
 */

import { HtmlEscapeUtil }                          from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SnapshotSpec, WorkItem }             from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { WorkItemState }                      from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import { filterChipMarkup }                        from '../../chips/FilterChipMarkup.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }           from '../../constants/StateLabels.ts';
import { GroupMarkup }                             from '../../epics/GroupMarkup.ts';
import { SearchMarkUtil }                          from '../../tickets/utils/SearchMarkUtil.ts';
import { MarkupUtil }                              from '../../utils/MarkupUtil.ts';
import { WorkItemMarkupUtil }                      from '../../utils/WorkItemMarkupUtil.ts';
import { WORK_ITEM_ID_ATTRIBUTE }                  from '../constants/SpecCardIdentityAttributes.ts';
import { SPEC_MARK_VOCABULARY }                    from '../constants/SpecMarkVocabulary.ts';
import { DISPLAY_STATE_FOR_WORK_ITEM_STATE }       from '../constants/WorkItemStateTranslations.ts';
import { SpecGroupMarks }                          from '../marks/SpecGroupMarks.ts';
import type { SpecTicketsView, SpecWorkItemEntry } from './SpecWorkItemViewUtil.ts';

/** Phase, title, ticked of total, state and what it waits on. */
export const SPEC_TICKET_TABLE_COLUMN_COUNT = 5;

/** The attribute each state chip carries its work-item state on. */
export const WORK_STATE_CHIP_ATTRIBUTE = 'data-work-state';

function stateLabelOf(state: WorkItemState): string {
  return STATE_LABEL_FOR_DISPLAY_STATE[DISPLAY_STATE_FOR_WORK_ITEM_STATE[state]];
}

/** A waited-on phase as its tag, which opens that work item's detail. */
function waitingOnTagsMarkup(workItem: WorkItem, phaseTagTextById: ReadonlyMap<string, string>): string {
  return workItem.waitingOn.map((workItemId) => (
    `<button type="button" class="ap-spec-phase-tag ap-spec-waiting-tag" ${MarkupUtil.attribute(SPEC_MARK_VOCABULARY.itemOpenerAttribute, workItemId)}>`
    + `${HtmlEscapeUtil.escapeHtml(phaseTagTextById.get(workItemId) ?? workItemId)}</button>`
  )).join('');
}

function workItemRowMarkup(workItem: WorkItem, query: string, phaseTagTextById: ReadonlyMap<string, string>): string {
  const displayState = DISPLAY_STATE_FOR_WORK_ITEM_STATE[workItem.state];
  return [
    `<tr ${MarkupUtil.attribute(WORK_ITEM_ID_ATTRIBUTE, workItem.id)} ${MarkupUtil.attribute('data-state', displayState)} tabindex="0">`,
    `<td>${SpecGroupMarks.phaseTagMarkup(workItem)}</td>`,
    `<td>${SearchMarkUtil.matchMarkedMarkup(workItem.title, query)}</td>`,
    `<td class="mono">${HtmlEscapeUtil.escapeHtml(`${workItem.tickedCount} of ${workItem.taskCount}`)}</td>`,
    `<td>${WorkItemMarkupUtil.stateBadgeMarkup(displayState, stateLabelOf(workItem.state))}</td>`,
    `<td><span class="ap-spec-waiting-tags">${waitingOnTagsMarkup(workItem, phaseTagTextById)}</span></td>`,
    '</tr>',
  ].join('');
}

function specGroupRowMarkup(spec: SnapshotSpec): string {
  const doneCount = spec.workItems.filter((workItem) => workItem.state === 'done').length;
  return GroupMarkup.groupRowMarkup(spec.colourSlot, SPEC_TICKET_TABLE_COLUMN_COUNT, [
    GroupMarkup.groupTitleButtonMarkup(SpecGroupMarks.specMarkOf(spec), SPEC_MARK_VOCABULARY),
    GroupMarkup.rollupBarMarkup(SpecGroupMarks.specRollupOf(spec)),
    `<span class="ap-spec-group-done">${HtmlEscapeUtil.escapeHtml(`${doneCount} of ${spec.workItems.length} phases done`)}</span>`,
  ].join(''));
}

/** Each spec with a shown row under its group row, in the order the rows come. */
function specTicketRowsMarkup(shownEntries: readonly SpecWorkItemEntry[], allEntries: readonly SpecWorkItemEntry[], searchText: string): string {
  const query            = SearchMarkUtil.normalisedQueryOf(searchText);
  const phaseTagTextById = new Map(allEntries.map((entry) => [entry.workItem.id, SpecGroupMarks.phaseTagTextOf(entry.workItem)]));
  const rows: string[]   = [];
  let previousSpec: SnapshotSpec | null = null;
  for (const entry of shownEntries) {
    if (entry.spec !== previousSpec) {
      rows.push(specGroupRowMarkup(entry.spec));
      previousSpec = entry.spec;
    }
    rows.push(workItemRowMarkup(entry.workItem, query, phaseTagTextById));
  }
  return rows.join('');
}

function askedPhraseMarkup(view: SpecTicketsView, specLabelOf: (specKey: string) => string): string {
  const parts: string[] = [];
  const query           = view.searchText.trim();
  if (query !== '') {
    parts.push(`“${HtmlEscapeUtil.escapeHtml(query)}”`);
  }
  if (view.specChips.length > 0) {
    parts.push(`spec ${view.specChips.map((specKey) => HtmlEscapeUtil.escapeHtml(specLabelOf(specKey))).join(' or ')}`);
  }
  if (view.stateChips.length > 0) {
    parts.push(`state ${view.stateChips.map((state) => HtmlEscapeUtil.escapeHtml(stateLabelOf(state))).join(' or ')}`);
  }
  return parts.length === 0 ? 'the view' : parts.join(', ');
}

function emptySpecTicketTableMarkup(view: SpecTicketsView, narrows: boolean, specLabelOf: (specKey: string) => string): string {
  return WorkItemMarkupUtil.emptyTableRowMarkup('work item', askedPhraseMarkup(view, specLabelOf), SPEC_TICKET_TABLE_COLUMN_COUNT, narrows);
}

function specChipsMarkup(specs: readonly SnapshotSpec[]): string {
  return specs.map((spec) => {
    const specMark = SpecGroupMarks.specMarkOf(spec);
    return filterChipMarkup(SPEC_MARK_VOCABULARY.filterChipAttribute, { value: spec.folderName, label: specMark.title, slot: specMark.slot });
  }).join('');
}

function stateChipsMarkup(states: readonly WorkItemState[]): string {
  return states.map((state) => {
    const chip = { value: state, label: stateLabelOf(state), stateToken: DISPLAY_STATE_FOR_WORK_ITEM_STATE[state] };
    return filterChipMarkup(WORK_STATE_CHIP_ATTRIBUTE, chip);
  }).join('');
}

function workItemCountText(shownCount: number, totalCount: number): string {
  return totalCount === 0 ? 'no work items' : `${shownCount} of ${totalCount} work item${totalCount === 1 ? '' : 's'}`;
}

export const SpecTicketsMarkup = Object.freeze({
  specTicketRowsMarkup,
  emptySpecTicketTableMarkup,
  specChipsMarkup,
  stateChipsMarkup,
  workItemCountText,
});
