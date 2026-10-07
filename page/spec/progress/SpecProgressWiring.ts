/**
 * The spec page's Progress tab on the shared chart: its stage rows under a foldable head row per spec, drawn up to the moment the
 * snapshot was taken, and the note saying where the dates come from.
 */

import type { SpecSnapshot }          from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { PageLimits }            from '../../../src/shared/@types/PagePayload.ts';
import { createGanttChartController } from '../../progress/GanttChartController.ts';
import { DomUtil }                    from '../../utils/DomUtil.ts';
import { TimeUtil }                   from '../../utils/TimeUtil.ts';
import type { SpecViewerPreferences } from '../preferences/SpecViewerPreferences.ts';
import { rowGroupingOfSpecs }         from './SpecRowGrouping.ts';
import type { SpecStageRow }          from './SpecStageRows.ts';
import { SpecStageRows }              from './SpecStageRows.ts';

export const PROGRESS_NOTE_ELEMENT_ID = 'ap-spec-progress-note';

export interface SpecProgressSources {
  snapshot:                     SpecSnapshot;
  limits:                       PageLimits;
  preferences:                  SpecViewerPreferences;
  /** When the snapshot was taken: the chart's now line, and the end of every open stage. */
  generatedAtEpochMilliseconds: number;
}

function earliestStartOf(rows: readonly SpecStageRow[]): string | null {
  return rows.reduce<string | null>((earliest, row) => {
    const start = TimeUtil.epochMillisecondsOf(row.start);
    const known = earliest === null ? null : TimeUtil.epochMillisecondsOf(earliest);
    return start !== null && (known === null || start < known) ? row.start : earliest;
  }, null);
}

export function wireSpecProgress(sources: SpecProgressSources): void {
  const {
    snapshot, limits, preferences, generatedAtEpochMilliseconds
  } = sources;
  // The chart reverses the rows it is handed, drawing the last on top, so the first spec's first stage is handed in last.
  const rows = SpecStageRows.stageRowsOf(snapshot).toReversed();
  DomUtil.setMarkup(PROGRESS_NOTE_ELEMENT_ID, SpecStageRows.progressNoteMarkupOf(rows));
  const controller = createGanttChartController<SpecStageRow>({
    progress: {
      startedAt: earliestStartOf(rows) ?? snapshot.generatedAt,
      view:      { kind: 'auto' },
      tasks:     rows,
    },
    limits,
    rows,
    rowGrouping:          rowGroupingOfSpecs(snapshot.specs),
    waitingOnOf:          () => [],
    trailingNameMarkupOf: SpecStageRows.trailingNameMarkupOf,
    nowEpochMilliseconds: () => generatedAtEpochMilliseconds,
    preferences,
  });
  controller.applyNameColumnWidth();
  controller.layOut(true);
  controller.wireRangeBar();
  controller.wireNameColumn();
  controller.wireChartWidth();
  controller.wireEpicGroups();
}
