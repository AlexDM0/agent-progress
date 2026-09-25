/** The DOM-free half of the page's range: the range presets, and the range the geometry is finally given after the viewer's override. */

import type { ProgressFile, ViewRange } from '../src/lib/tracker-model/@types/ProgressFile.ts';
import type { PageLimits }              from '../src/shared/@types/PagePayload.ts';
import type { StoredViewOverride }      from './preferences/ViewerPreferences.ts';
import { GeometryUtil }                 from './utils/GeometryUtil.ts';

export const RANGE_PRESET_BOUNDS: Readonly<Record<string, { fromText: string | null; toText: string | null }>> = {
  'auto': { fromText: null, toText: null },
  '1h':   { fromText: '-1h', toText: 'now' },
  '4h':   { fromText: '-4h', toText: 'now' },
  '12h':  { fromText: '-12h', toText: 'now' },
  '24h':  { fromText: '-24h', toText: 'now' },
  '7d':   { fromText: '-7d', toText: 'now' },
  'all':  { fromText: 'start', toText: 'now' },
};

export function effectiveRangeFor(progress: ProgressFile, override: StoredViewOverride, nowEpochMilliseconds: number, limits: PageLimits): ViewRange {
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
