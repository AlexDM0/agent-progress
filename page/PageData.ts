/** The DOM-free half of the page's range: the viewer's stored override and the range the geometry is finally given. */

import type { ProgressFile, ViewRange } from '../src/lib/tracker-model/@types/ProgressFile.ts';
import type { PageLimits }              from '../src/shared/@types/PagePayload.ts';
import { GeometryUtil }                 from './utils/GeometryUtil.ts';
import { JsonValueUtil }                from './utils/JsonValueUtil.ts';

export interface StoredViewOverride {
  presetKey:   string | null;
  fromText:    string | null;
  toText:      string | null;
  tickMinutes: number | null;
}

export const EMPTY_VIEW_OVERRIDE: StoredViewOverride = {
  presetKey:   null,
  fromText:    null,
  toText:      null,
  tickMinutes: null,
};

export const RANGE_PRESET_BOUNDS: Readonly<Record<string, { fromText: string | null; toText: string | null }>> = {
  'auto': { fromText: null, toText: null },
  '1h':   { fromText: '-1h', toText: 'now' },
  '4h':   { fromText: '-4h', toText: 'now' },
  '12h':  { fromText: '-12h', toText: 'now' },
  '24h':  { fromText: '-24h', toText: 'now' },
  '7d':   { fromText: '-7d', toText: 'now' },
  'all':  { fromText: 'start', toText: 'now' },
};

/** `file://` is one origin in Chrome, so the tracker id is what keeps two dashboards' ranges apart. */
export function storageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}`;
}

export function storedOverrideFrom(value: unknown): StoredViewOverride {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return EMPTY_VIEW_OVERRIDE;
  }
  return {
    presetKey:   JsonValueUtil.textOrNull(value['presetKey']),
    fromText:    JsonValueUtil.textOrNull(value['fromText']),
    toText:      JsonValueUtil.textOrNull(value['toText']),
    tickMinutes: JsonValueUtil.finiteNumberOrNull(value['tickMinutes']),
  };
}

export function overrideIsEmpty(override: StoredViewOverride): boolean {
  return override.fromText === null && override.toText === null && override.tickMinutes === null;
}

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
