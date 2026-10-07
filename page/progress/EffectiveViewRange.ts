/**
 * The range the geometry is finally given, once the viewer's stored override is laid over the tracker's own. Without typed bounds the
 * tracker's own range holds when the `range` command set one, and otherwise Fit spans the rows the page hands in.
 */

import type { ViewRange }          from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { StoredViewOverride } from '../@types/ViewerChoices.ts';
import type { StartedRow }         from './utils/FitRangeUtil.ts';
import { FitRangeUtil }            from './utils/FitRangeUtil.ts';

/** The tracker's own range and the rows Fit spans. */
export interface ViewedRows {
  view:  ViewRange;
  tasks: readonly StartedRow[];
}

export function effectiveViewRangeFor(progress: ViewedRows, override: StoredViewOverride, nowEpochMilliseconds: number): ViewRange {
  if (override.fromText !== null && override.toText !== null) {
    return {
      kind:        'relative',
      from:        override.fromText,
      to:          override.toText,
      tickMinutes: override.tickMinutes,
    };
  }
  const base = progress.view;
  if (base.kind !== 'auto') {
    return override.tickMinutes === null ? base : {
      kind:        base.kind,
      from:        base.from,
      to:          base.to,
      tickMinutes: override.tickMinutes,
    };
  }
  const fitted = FitRangeUtil.fittedSpanOf(progress.tasks, nowEpochMilliseconds);
  return {
    kind:        'absolute',
    from:        new Date(fitted.fromEpochMilliseconds).toISOString(),
    to:          new Date(fitted.toEpochMilliseconds).toISOString(),
    tickMinutes: override.tickMinutes,
  };
}
