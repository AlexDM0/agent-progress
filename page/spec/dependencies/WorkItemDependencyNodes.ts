/**
 * The snapshot's work items as the shared wave graph's input and nodes: a work item settles its dependents once done, groups under its
 * spec, leads with its phase tag and wears its spec's chip, and its state chip while in progress; the graph shows no slot meter.
 */

import { HtmlEscapeUtil }                            from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SnapshotSpec, SpecSnapshot, WorkItem } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { DependencyGraphReaders }               from '../../@types/DependencyGraph.ts';
import type { DependencyGraphOptions }               from '../../dependencies/WaveGraphMarkup.ts';
import type { DependencyNodeModel }                  from '../../dependencies/WaveGraphMarkup.ts';
import { GroupMarkup }                               from '../../epics/GroupMarkup.ts';
import { MarkupUtil }                                from '../../utils/MarkupUtil.ts';
import { SPEC_MARK_VOCABULARY }                      from '../constants/SpecMarkVocabulary.ts';
import { DISPLAY_STATE_FOR_WORK_ITEM_STATE }         from '../constants/WorkItemStateTranslations.ts';
import { SpecGroupMarks }                            from '../marks/SpecGroupMarks.ts';

/** A work item with the folder name of the spec it belongs to. */
export type WorkItemGraphItem = WorkItem & { readonly specKey: string };

const WORK_ITEM_GRAPH_READERS: DependencyGraphReaders<WorkItemGraphItem> = Object.freeze({
  settlesDependents: (item: WorkItemGraphItem) => item.state === 'done',
  primaryGroupKeyOf: (item: WorkItemGraphItem) => item.specKey,
});

function graphItemsOf(snapshot: SpecSnapshot): WorkItemGraphItem[] {
  return snapshot.specs.flatMap((spec) => spec.workItems.map((workItem) => ({ ...workItem, specKey: spec.folderName })));
}

function dependencyNodeOf(workItem: WorkItem): DependencyNodeModel {
  return {
    id:         workItem.id,
    idLabel:    SpecGroupMarks.phaseTagTextOf(workItem),
    title:      workItem.title,
    dependsOn:  workItem.dependsOn,
    tone:       DISPLAY_STATE_FOR_WORK_ITEM_STATE[workItem.state],
    isInReview: false,
    // As on the tracker graph, only work under way wears its state; a waiting node's stripe already says it is to do.
    chips:      workItem.state === 'in-progress' ? [{ kind: 'state', displayState: DISPLAY_STATE_FOR_WORK_ITEM_STATE[workItem.state] }] : [],
  };
}

function nodeByIdOf(snapshot: SpecSnapshot): Map<string, DependencyNodeModel> {
  return new Map(snapshot.specs.flatMap((spec) => spec.workItems.map((workItem) => [workItem.id, dependencyNodeOf(workItem)] as const)));
}

/** A mark, never a button: the node it sits in is the button. */
function specChipMarkup(spec: SnapshotSpec): string {
  const specMark = SpecGroupMarks.specMarkOf(spec);
  return `<span class="ap-spec-dependency-chip" ${MarkupUtil.attribute('title', `${SPEC_MARK_VOCABULARY.noun}: ${specMark.title}`)}>`
    + `${GroupMarkup.swatchMarkup(specMark)}${HtmlEscapeUtil.escapeHtml(SpecGroupMarks.specKeyOf(spec))}</span>`;
}

function graphOptionsOf(snapshot: SpecSnapshot): DependencyGraphOptions {
  const specOfWorkItem = new Map(snapshot.specs.flatMap((spec) => spec.workItems.map((workItem) => [workItem.id, spec] as const)));
  return {
    showsSlots:        false,
    doneCountTextOf:   (doneWorkItemIds) => `${doneWorkItemIds.length} done`,
    openAttribute:     SPEC_MARK_VOCABULARY.itemOpenerAttribute,
    emptyText:         'No open work item waits on another.',
    extraChipMarkupOf: (workItemId) => {
      const spec = specOfWorkItem.get(workItemId);
      return spec === undefined ? '' : specChipMarkup(spec);
    },
  };
}

export const WorkItemDependencyNodes = Object.freeze({
  WORK_ITEM_GRAPH_READERS,
  graphItemsOf,
  dependencyNodeOf,
  nodeByIdOf,
  graphOptionsOf,
});
