/**
 * A spec's detail on the shared group detail: everything its card shows, then the tasks ticked per `tasks.md` phase as small bars, each
 * stage's dates with their source, and the folder's path.
 */

import { HtmlEscapeUtil } from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type {
  SnapshotSpec,
  StageBoundary,
  StageSpan,
  WorkItem
} from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { GroupFactModel }               from '../../@types/GroupMarks.ts';
import type { GroupMarkupFormat }            from '../../@types/GroupMarks.ts';
import { DetailMarkupUtil }                  from '../../detail-dialog/utils/DetailMarkupUtil.ts';
import { GroupMarkup }                       from '../../epics/GroupMarkup.ts';
import { MarkupUtil }                        from '../../utils/MarkupUtil.ts';
import { TimeUtil }                          from '../../utils/TimeUtil.ts';
import { SPEC_LANE_TITLES }                  from '../constants/SpecLaneTitles.ts';
import { DISPLAY_STATE_FOR_WORK_ITEM_STATE } from '../constants/WorkItemStateTranslations.ts';
import { SpecGroupMarks }                    from '../marks/SpecGroupMarks.ts';
import { SpecCardMarkup }                    from './SpecCardMarkup.ts';
import { SpecCardSections }                  from './SpecCardSections.ts';

/** spec-kit's own layout: every feature folder sits under `specs/`. */
const SPECS_FOLDER = 'specs/';

function phaseNameOf(workItem: WorkItem): string {
  return workItem.kind === 'user-story' && workItem.storyNumber !== null ? `US${workItem.storyNumber}` : SpecGroupMarks.phaseTagTextOf(workItem);
}

function phaseBarMarkup(workItem: WorkItem): string {
  const tickedPercent = workItem.taskCount === 0 ? 0 : Math.round((workItem.tickedCount / workItem.taskCount) * 100);
  const countText     = `${workItem.tickedCount}/${workItem.taskCount}`;
  return `<li ${MarkupUtil.attribute('data-state', DISPLAY_STATE_FOR_WORK_ITEM_STATE[workItem.state])}>`
    + `<span class="ap-spec-task-phase-name">${HtmlEscapeUtil.escapeHtml(phaseNameOf(workItem))}</span> `
    + `<span class="ap-spec-task-bar" role="img" ${MarkupUtil.attribute('aria-label', `${workItem.tickedCount} of ${workItem.taskCount} ticked`)}>`
    + `<span style="width:${tickedPercent}%"></span></span> `
    + `<span class="ap-spec-task-count">${HtmlEscapeUtil.escapeHtml(countText)}</span></li>`;
}

function phaseBarsSectionMarkup(spec: SnapshotSpec): string {
  if (spec.workItems.length === 0) {
    return '';
  }
  const title = `Tasks ticked · ${spec.tasks.ticked} of ${spec.tasks.total}`;
  return DetailMarkupUtil.sectionMarkup(title, `<ul class="ap-spec-task-phases">${spec.workItems.map(phaseBarMarkup).join('')}</ul>`);
}

function boundaryMarkup(boundary: StageBoundary, format: GroupMarkupFormat): string {
  const fileName = SpecCardSections.fileNameOf(boundary.artefact);
  if (boundary.date === null) {
    return `<span>${HtmlEscapeUtil.escapeHtml(`${fileName}, date unknown`)}</span>`;
  }
  const { limits, todayCalendarDate } = format;
  const sourceText = `${fileName}, ${SpecCardSections.dateSourceTextOf(boundary.date)}`;
  return `<time ${MarkupUtil.attribute('title', TimeUtil.fullStampText(boundary.date.at, limits))}>`
    + `${HtmlEscapeUtil.escapeHtml(TimeUtil.shortStampText(boundary.date.at, todayCalendarDate, limits))}</time>`
    + ` <span class="ap-spec-stage-source">${HtmlEscapeUtil.escapeHtml(`(${sourceText})`)}</span>`;
}

function stageDateMarkup(stageSpan: StageSpan, format: GroupMarkupFormat): string {
  const endMarkup = stageSpan.end === null ? '<span>still open</span>' : boundaryMarkup(stageSpan.end, format);
  return `<li><span class="ap-spec-stage-name">${HtmlEscapeUtil.escapeHtml(SPEC_LANE_TITLES[stageSpan.stage])}</span> `
    + `${boundaryMarkup(stageSpan.start, format)} → ${endMarkup}</li>`;
}

function stageDatesMarkup(spec: SnapshotSpec, format: GroupMarkupFormat): string {
  return spec.stageSpans.length === 0
    ? ''
    : `<ul class="ap-spec-stage-dates">${spec.stageSpans.map((stageSpan) => stageDateMarkup(stageSpan, format)).join('')}</ul>`;
}

function folderFactOf(spec: SnapshotSpec): GroupFactModel {
  return { label: 'folder', valueMarkup: `<code>${HtmlEscapeUtil.escapeHtml(`${SPECS_FOLDER}${spec.folderName}/`)}</code>` };
}

export function specDetailMarkup(spec: SnapshotSpec, format: GroupMarkupFormat): string {
  const doneMark = SpecCardSections.doneMarkOf(spec);
  return GroupMarkup.groupDetailMarkup({
    slot:      spec.colourSlot,
    title:     spec.title,
    typeTags:  ['spec', SPEC_LANE_TITLES[spec.lane], doneMark.text],
    bodyParts: [
      GroupMarkup.factsLineMarkup([folderFactOf(spec)]),
      DetailMarkupUtil.sectionMarkup('Phases', `${SpecCardMarkup.stepperRowMarkup(spec)}${stageDatesMarkup(spec, format)}`),
      DetailMarkupUtil.sectionMarkup('From spec files', SpecCardSections.factsMarkup(spec)),
      spec.stories.length === 0 ? '' : DetailMarkupUtil.sectionMarkup('User stories', SpecCardSections.storiesMarkup(spec)),
      phaseBarsSectionMarkup(spec),
      DetailMarkupUtil.sectionMarkup('Files', SpecCardSections.filesMarkup(spec)),
      spec.checklists.length === 0 ? '' : DetailMarkupUtil.sectionMarkup('Checklists', SpecCardSections.checklistsMarkup(spec)),
      DetailMarkupUtil.sectionMarkup('Progress', `${SpecCardSections.rollupMarkup(spec)}${GroupMarkup.factsLineMarkup([SpecCardSections.spanFactOf(spec, format)])}`),
    ],
  });
}
