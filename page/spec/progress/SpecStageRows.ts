/**
 * The spec page's Progress rows: one per stage span with a known start, named for its stage, `in-progress` while open and `delivered` once
 * closed. An open stage carries one `in-progress` phase at its start, which is what the chart draws as the live hatch. The spans and their
 * dates are the snapshot's; nothing here computes one.
 */

import { HtmlEscapeUtil } from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type {
  SnapshotDate,
  SnapshotSpec,
  SpecSnapshot,
  StageSpan
} from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { SpecStage }           from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { ChartRowSource }      from '../../progress/GanttChartMarkup.ts';
import { MarkupUtil }               from '../../utils/MarkupUtil.ts';
import { MODIFICATION_TIME_SOURCE } from '../constants/SnapshotDateSources.ts';

export type SpecStageName = 'Specify' | 'Plan' | 'Implement';

export interface SpecStageRow extends ChartRowSource {
  name:                      SpecStageName;
  start:                     string;
  end:                       string | null;
  displayState:              'in-progress' | 'delivered';
  specFolderName:            string;
  specTitle:                 string;
  /** Either end of the stage was dated from a file's modification time, its creation time being unknown. */
  datedFromModificationTime: boolean;
}

export const STAGE_NAMES: Readonly<Record<SpecStage, SpecStageName>> = Object.freeze({
  specify:   'Specify',
  plan:      'Plan',
  implement: 'Implement',
});

export const MODIFICATION_TIME_MARK = '~';

function datedFromModificationTime(date: SnapshotDate | null | undefined): boolean {
  return date?.source === MODIFICATION_TIME_SOURCE;
}

/** A closed stage whose end date is unknown is drawn at its start, never reaching on to the snapshot's moment as an open one does. */
function stageRowOf(spec: SnapshotSpec, stageSpan: StageSpan, start: SnapshotDate): SpecStageRow {
  const { isOpen } = stageSpan;
  const end    = isOpen ? null : stageSpan.end?.date?.at ?? start.at;
  return {
    name:                      STAGE_NAMES[stageSpan.stage],
    start:                     start.at,
    end,
    displayState:              isOpen ? 'in-progress' : 'delivered',
    ...isOpen ? { history: [{ status: 'in-progress', at: start.at }] } : {},
    specFolderName:            spec.folderName,
    specTitle:                 spec.title,
    datedFromModificationTime: datedFromModificationTime(start) || datedFromModificationTime(stageSpan.end?.date),
  };
}

/** In folder order, each spec's stages in order; the chart draws the last row handed in on top, so the caller reverses them. */
function stageRowsOf(snapshot: SpecSnapshot): SpecStageRow[] {
  return snapshot.specs.flatMap((spec) => spec.stageSpans.flatMap((stageSpan) => {
    const start = stageSpan.start.date;
    return start === null ? [] : [stageRowOf(spec, stageSpan, start)];
  }));
}

/** The spec the stage belongs to, and the mark of a date taken from a modification time. */
function trailingNameMarkupOf(row: SpecStageRow): string {
  const specTag = `<span class="ap-spec-progress-spec" ${MarkupUtil.attribute('title', row.specTitle)}>${HtmlEscapeUtil.escapeHtml(row.specFolderName)}</span>`;
  const dateMark = row.datedFromModificationTime
    ? `<span class="ap-spec-progress-date-mark" title="Dated from a file's modification time">${MODIFICATION_TIME_MARK}</span>`
    : '';
  return `${specTag}${dateMark}`;
}

/** Where the dates come from, and how many of the rows took theirs from a modification time. */
function progressNoteMarkupOf(rows: readonly SpecStageRow[]): string {
  const markedCount = rows.filter((row) => row.datedFromModificationTime).length;
  const markedText  = markedCount === 0
    ? ''
    : ` ${markedCount === rows.length ? 'Every stage here is' : `${markedCount} of ${rows.length} stages here are`} dated that way.`;
  return 'Dates are the files’ creation dates on this machine, so a fresh clone or checkout shows them all at that moment. '
    + `A date taken from a file’s modification time instead is marked <span class="ap-spec-progress-date-mark">${MODIFICATION_TIME_MARK}</span>.`
    + HtmlEscapeUtil.escapeHtml(markedText);
}

export const SpecStageRows = Object.freeze({
  stageRowsOf,
  trailingNameMarkupOf,
  progressNoteMarkupOf,
});
