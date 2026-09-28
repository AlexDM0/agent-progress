/** The range the geometry is finally given, once the viewer's stored override is laid over the tracker's own. */

import type { TrackerProgress, ViewRange } from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { TimelineLimits }             from '../@types/Timeline.ts';
import type { StoredViewOverride }         from '../@types/ViewerChoices.ts';
import { GeometryUtil }                    from '../utils/GeometryUtil.ts';

export function effectiveViewRangeFor(progress: TrackerProgress, override: StoredViewOverride, nowEpochMilliseconds: number, limits: TimelineLimits): ViewRange {
  if (override.fromText !== null && override.toText !== null) {
    return {
      kind:        'relative',
      from:        override.fromText,
      to:          override.toText,
      tickMinutes: override.tickMinutes,
    };
  }
  const base = progress.view;
  if (override.tickMinutes === null) {
    return base;
  }
  if (base.kind !== 'auto') {
    return {
      kind:        base.kind,
      from:        base.from,
      to:          base.to,
      tickMinutes: override.tickMinutes,
    };
  }
  const automatic = GeometryUtil.computeTimeline({
    progress,
    range: base,
    nowEpochMilliseconds,
    limits,
  });
  return {
    kind:        'absolute',
    from:        new Date(automatic.fromEpochMilliseconds).toISOString(),
    to:          new Date(automatic.toEpochMilliseconds).toISOString(),
    tickMinutes: override.tickMinutes,
  };
}
