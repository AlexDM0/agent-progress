/** The spec page's Progress rows grouped under a head row per spec, in folder order; no stage row is ever ungrouped. */

import type { SnapshotSpec, StageSpan }         from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { GroupMarkup }                          from '../../epics/GroupMarkup.ts';
import type { ChartGroupModel, ChartGroupSpan } from '../../progress/RowGrouping.ts';
import type { RowGroupingSource }               from '../../progress/RowGrouping.ts';
import { TimeUtil }                             from '../../utils/TimeUtil.ts';
import { SPEC_MARK_VOCABULARY }                 from '../constants/SpecMarkVocabulary.ts';
import { SpecGroupMarks }                       from '../marks/SpecGroupMarks.ts';
import type { SpecStageRow }                    from './SpecStageRows.ts';
import { STAGE_NAMES }                          from './SpecStageRows.ts';

const STAGE_COUNT = Object.keys(STAGE_NAMES).length;

interface DatedStage {
  start: string;
  /** A closed stage whose end date is unknown ends at its start, as its row is drawn. */
  end:   string | null;
}

function datedStagesOf(stageSpans: readonly StageSpan[]): DatedStage[] {
  return stageSpans.flatMap((stageSpan) => {
    const start = stageSpan.start.date?.at;
    return start === undefined ? [] : [{ start, end: stageSpan.isOpen ? null : stageSpan.end?.date?.at ?? start }];
  });
}

function stampOrdering(a: string, b: string): number {
  return (TimeUtil.epochMillisecondsOf(a) ?? 0) - (TimeUtil.epochMillisecondsOf(b) ?? 0);
}

/** From the first stage's start to the last stage's end, open to now while any stage is open; null when no stage is dated. */
function specSpanOf(spec: SnapshotSpec, label: string): ChartGroupSpan | null {
  const datedStages = datedStagesOf(spec.stageSpans);
  const [start]     = datedStages.map((stage) => stage.start).toSorted(stampOrdering);
  if (start === undefined) {
    return null;
  }
  const ends = datedStages.map((stage) => stage.end);
  const end  = spec.stageSpans.some((stageSpan) => stageSpan.isOpen) ? null : ends.filter((stamp) => stamp !== null).toSorted(stampOrdering).at(-1) ?? start;
  return { start, end, label };
}

function specGroupOf(spec: SnapshotSpec): ChartGroupModel {
  const specMark         = SpecGroupMarks.specMarkOf(spec);
  const closedStageCount = spec.stageSpans.filter((stageSpan) => !stageSpan.isOpen).length;
  return {
    key:               specMark.key,
    slot:              specMark.slot,
    chipMarkup:        GroupMarkup.groupChipsMarkup([specMark], SPEC_MARK_VOCABULARY),
    span:              specSpanOf(spec, specMark.title),
    isOpen:            spec.lane !== 'done',
    doneText:          `${closedStageCount} of ${STAGE_COUNT} stages`,
    sharedMemberCount: 0,
  };
}

export function rowGroupingOfSpecs(specs: readonly SnapshotSpec[]): RowGroupingSource<SpecStageRow> {
  return {
    groups:        specs.map(specGroupOf),
    groupKeyOfRow: (row) => row.specFolderName,
    ungroupedHead: null,
  };
}
