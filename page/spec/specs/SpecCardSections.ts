/**
 * The parts of a spec that its card and its detail both show, each from the snapshot as it stands: the done mark, the facts line, the user
 * stories, the files row, the checklists, the work items' roll-up and the span from `spec.md`'s creation.
 */

import { HtmlEscapeUtil }                                    from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SnapshotDate, SnapshotSpec, SpecArtefactKind } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { GroupFactModel, GroupItemRowModel }            from '../../@types/GroupMarks.ts';
import type { GroupMarkupFormat }                            from '../../@types/GroupMarks.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }                     from '../../constants/StateLabels.ts';
import { GroupMarkup }                                       from '../../epics/GroupMarkup.ts';
import { MarkupUtil }                                        from '../../utils/MarkupUtil.ts';
import { TimeUtil }                                          from '../../utils/TimeUtil.ts';
import { MODIFICATION_TIME_SOURCE }                          from '../constants/SnapshotDateSources.ts';
import { SPEC_MARK_VOCABULARY }                              from '../constants/SpecMarkVocabulary.ts';
import { DISPLAY_STATE_FOR_WORK_ITEM_STATE }                 from '../constants/WorkItemStateTranslations.ts';
import { SpecGroupMarks }                                    from '../marks/SpecGroupMarks.ts';

type SpecFileKind = Exclude<SpecArtefactKind, 'checklist'>;

/** The files row, in the order spec-kit writes them. */
const FILE_NAME_FOR_KIND: Readonly<Record<SpecFileKind, string>> = Object.freeze({
  'spec':       'spec.md',
  'plan':       'plan.md',
  'research':   'research.md',
  'data-model': 'data-model.md',
  'contracts':  'contracts/',
  'quickstart': 'quickstart.md',
  'tasks':      'tasks.md',
});

/** How a date's source reads; a source not listed shows as the snapshot writes it. */
const DATE_SOURCE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'birth-time':               'file created',
  [MODIFICATION_TIME_SOURCE]: 'file modified',
});

const NOT_CUT_TEXT       = 'not cut yet';
const NOT_CUT_TITLE_TEXT = 'Work items are cut from tasks.md';

function dateSourceTextOf(date: SnapshotDate): string {
  return Object.hasOwn(DATE_SOURCE_TEXT, date.source) ? DATE_SOURCE_TEXT[date.source] ?? date.source : date.source;
}

function fileNameOf(kind: SpecArtefactKind): string {
  return kind === 'checklist' ? 'checklist' : FILE_NAME_FOR_KIND[kind];
}

function specIsCut(spec: SnapshotSpec): boolean {
  return spec.workItems.length > 0;
}

function doneWorkItemCountOf(spec: SnapshotSpec): number {
  return spec.workItems.filter((workItem) => workItem.state === 'done').length;
}

/** `3 of 6 phases done`, or `not cut yet` before `tasks.md` holds a phase. */
function doneMarkOf(spec: SnapshotSpec): { text: string; titleText: string | null } {
  return specIsCut(spec)
    ? { text: `${doneWorkItemCountOf(spec)} of ${spec.workItems.length} phases done`, titleText: null }
    : { text: NOT_CUT_TEXT, titleText: NOT_CUT_TITLE_TEXT };
}

function plainFactOf(label: string, value: string): GroupFactModel {
  return { label, valueMarkup: `<span>${HtmlEscapeUtil.escapeHtml(value)}</span>` };
}

function factsOf(spec: SnapshotSpec): GroupFactModel[] {
  const { counts } = spec;
  return [
    plainFactOf('stories', String(spec.stories.length)),
    plainFactOf('FR', String(counts.functionalRequirements)),
    plainFactOf('SC', String(counts.successCriteria)),
    plainFactOf('open clarifications', String(counts.openMarkers)),
    plainFactOf('clarify sessions', String(counts.clarificationSessions)),
    plainFactOf('answers', String(counts.clarificationAnswers)),
    ...(specIsCut(spec) ? [plainFactOf('tasks ticked', `${spec.tasks.ticked}/${spec.tasks.total}`)] : []),
  ];
}

function factsMarkup(spec: SnapshotSpec): string {
  return GroupMarkup.factsLineMarkup(factsOf(spec));
}

/** Each story opens its `tasks.md` phase where it has one, its badge that phase's state. */
function storyRowsOf(spec: SnapshotSpec): GroupItemRowModel[] {
  return spec.stories.map((story) => {
    const workItem     = spec.workItems.find((candidate) => candidate.storyNumber === story.number);
    const priorityText = `P${story.priority}`;
    if (story.phaseState === null) {
      return {
        opener: workItem?.id ?? null, leadText: `US${story.number}`, title: story.title, otherGroups: [], badge: null, note: `${priorityText} · ${NOT_CUT_TEXT}`
      };
    }
    const displayState = DISPLAY_STATE_FOR_WORK_ITEM_STATE[story.phaseState];
    return {
      opener:      workItem?.id ?? null,
      leadText:    `US${story.number}`,
      title:       story.title,
      otherGroups: [],
      badge:       { stateToken: displayState, label: STATE_LABEL_FOR_DISPLAY_STATE[displayState] },
      note:        priorityText,
    };
  });
}

function storiesMarkup(spec: SnapshotSpec): string {
  return spec.stories.length === 0 ? '' : GroupMarkup.groupItemListMarkup(storyRowsOf(spec), SPEC_MARK_VOCABULARY);
}

/** Every file spec-kit writes for a spec, an absent one muted and a template copy marked. */
function filesMarkup(spec: SnapshotSpec): string {
  const items = Object.entries(FILE_NAME_FOR_KIND).map(([kind, fileName]) => {
    const artefact = spec.artefacts.find((candidate) => candidate.kind === kind);
    if (artefact === undefined) {
      return `<li class="ap-spec-file" data-file-state="missing" ${MarkupUtil.attribute('title', `${fileName} is not written yet`)}>${HtmlEscapeUtil.escapeHtml(fileName)}</li>`;
    }
    if (artefact.state === 'template') {
      return `<li class="ap-spec-file" data-file-state="template" ${MarkupUtil.attribute('title', `${fileName} is still spec-kit's template`)}>`
        + `${HtmlEscapeUtil.escapeHtml(fileName)}<span class="ap-spec-file-mark">template</span></li>`;
    }
    const fileCountMarkup = artefact.fileCount === undefined ? '' : `<span class="ap-spec-file-mark">${HtmlEscapeUtil.escapeHtml(String(artefact.fileCount))}</span>`;
    return `<li class="ap-spec-file" data-file-state="filled">${HtmlEscapeUtil.escapeHtml(fileName)}${fileCountMarkup}</li>`;
  });
  return `<ul class="ap-spec-files" aria-label="Spec files">${items.join('')}</ul>`;
}

function checklistsMarkup(spec: SnapshotSpec): string {
  if (spec.checklists.length === 0) {
    return '';
  }
  const items = spec.checklists.map((checklist) => (
    `<li><span class="ap-spec-checklist-title">${HtmlEscapeUtil.escapeHtml(checklist.title)}</span>`
    + `<span class="ap-spec-checklist-count">${HtmlEscapeUtil.escapeHtml(`${checklist.checked}/${checklist.total}`)}</span></li>`
  ));
  return `<ul class="ap-spec-checklists" aria-label="Checklists">${items.join('')}</ul>`;
}

function rollupMarkup(spec: SnapshotSpec): string {
  if (!specIsCut(spec)) {
    return '';
  }
  const rollup = SpecGroupMarks.specRollupOf(spec);
  return `<div>${GroupMarkup.rollupBarMarkup(rollup)}${GroupMarkup.rollupLegendMarkup(rollup)}</div>`;
}

/** The last stage's end once the spec is done, otherwise now. */
function spanEndOf(spec: SnapshotSpec): SnapshotDate | null {
  return spec.lane === 'done' ? spec.stageSpans.at(-1)?.end?.date ?? null : null;
}

function spanFactOf(spec: SnapshotSpec, format: GroupMarkupFormat): GroupFactModel {
  const start = spec.artefacts.find((artefact) => artefact.kind === 'spec')?.created ?? null;
  if (start === null) {
    return plainFactOf('span', 'not started');
  }
  const { limits, todayCalendarDate } = format;
  const end               = spanEndOf(spec);
  const startMilliseconds = TimeUtil.epochMillisecondsOf(start.at);
  const endMilliseconds   = end === null ? format.nowEpochMilliseconds : TimeUtil.epochMillisecondsOf(end.at);
  const duration          = startMilliseconds === null || endMilliseconds === null ? null : TimeUtil.formatDuration(endMilliseconds - startMilliseconds, limits);
  const sourceText        = start.source === MODIFICATION_TIME_SOURCE ? ` (from ${dateSourceTextOf(start)})` : '';
  const endText           = end === null ? 'now' : TimeUtil.shortStampText(end.at, todayCalendarDate, limits);
  const title             = `${TimeUtil.fullStampText(start.at, limits)} → ${end === null ? 'still open' : TimeUtil.fullStampText(end.at, limits)}`;
  const text              = `${TimeUtil.shortStampText(start.at, todayCalendarDate, limits)}${sourceText} → ${endText}${duration === null ? '' : ` · ${duration}`}`;
  return { label: 'span', valueMarkup: `<span ${MarkupUtil.attribute('title', title)}>${HtmlEscapeUtil.escapeHtml(text)}</span>` };
}

export const SpecCardSections = Object.freeze({
  dateSourceTextOf,
  fileNameOf,
  doneMarkOf,
  factsMarkup,
  storiesMarkup,
  filesMarkup,
  checklistsMarkup,
  rollupMarkup,
  spanFactOf,
});
