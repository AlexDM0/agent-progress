/** A spec as a group mark and a roll-up, and a work item's phase tag: what the shared group renderers and the spec cards draw. */

import { HtmlEscapeUtil }                    from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SnapshotSpec, WorkItem }       from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { SourcePhaseKind }              from '../../../src/lib/spec-snapshot/@types/SpecSnapshotSource.ts';
import { WORK_ITEM_STATES }                  from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { GroupMark, GroupRollupModel }  from '../../@types/GroupMarks.ts';
import { DISPLAY_STATE_FOR_WORK_ITEM_STATE } from '../constants/WorkItemStateTranslations.ts';

const PHASE_TAG_TEXT_FOR_KIND: Readonly<Record<Exclude<SourcePhaseKind, 'user-story' | 'other'>, string>> = {
  'setup':        'Setup',
  'foundational': 'Foundational',
  'polish':       'Polish',
  'convergence':  'Converge',
};

/** A roll-up reads finished work first. */
const ROLLUP_STATE_ORDER = [...WORK_ITEM_STATES].reverse();

const LEADING_DIGITS_PATTERN = /^\d+/;

/** The folder name's leading digits, as the folder writes them; the whole folder name when it has none. */
function specKeyOf(spec: SnapshotSpec): string {
  return LEADING_DIGITS_PATTERN.exec(spec.folderName)?.[0] ?? spec.folderName;
}

function specMarkOf(spec: SnapshotSpec): GroupMark {
  const key = specKeyOf(spec);
  return { key: spec.folderName, title: key === spec.folderName ? spec.title : `${key} ${spec.title}`, slot: spec.colourSlot };
}

function specRollupOf(spec: SnapshotSpec): GroupRollupModel {
  const segments = ROLLUP_STATE_ORDER
    .map((state) => ({ state: DISPLAY_STATE_FOR_WORK_ITEM_STATE[state], count: spec.workItems.filter((workItem) => workItem.state === state).length }))
    .filter((segment) => segment.count > 0);
  const doneCount = spec.workItems.filter((workItem) => workItem.state === 'done').length;
  return { segments, ariaLabel: `${doneCount} of ${spec.workItems.length} work items done` };
}

function phaseTagTextOf(workItem: WorkItem): string {
  if (workItem.tagText !== null) {
    return workItem.tagText;
  }
  if (workItem.kind === 'user-story') {
    return workItem.storyNumber === null ? 'Story' : `US${workItem.storyNumber}`;
  }
  return workItem.kind === 'other' ? `Phase ${workItem.ordinal}` : PHASE_TAG_TEXT_FOR_KIND[workItem.kind];
}

function phaseTagMarkup(workItem: WorkItem): string {
  return `<span class="ap-spec-phase-tag">${HtmlEscapeUtil.escapeHtml(phaseTagTextOf(workItem))}</span>`;
}

export const SpecGroupMarks = Object.freeze({
  specKeyOf,
  specMarkOf,
  specRollupOf,
  phaseTagTextOf,
  phaseTagMarkup,
});
