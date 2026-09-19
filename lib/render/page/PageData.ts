/** The DOM-free half of the page: the island shapes, the checks that establish them, and the range the geometry is finally given. */

import type { ProgressFile, TicketFrontmatter, ViewRange } from '../../constants/Types.ts';
import type { TimelineLimits }                             from './GanttGeometry.ts';
import { computeTimeline }                                 from './GanttGeometry.ts';

export interface PageLimits extends TimelineLimits {
  dateAndClockLength:    number;
  calendarDateLength:    number;
  monthAndDaySliceStart: number;
  clockSliceStart:       number;
  clockSliceEnd:         number;
}

export interface PagePayload {
  progress:                     ProgressFile;
  generatedAtEpochMilliseconds: number;
  limits:                       PageLimits;
  pageScriptFailure:            string | null;
}

export interface PageTicket extends TicketFrontmatter {
  filePath: string;
  bodyHtml: string;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const REQUIRED_LIMIT_NAMES = [
  'maximumTicksPerAxis',
  'axisMinimumSpanMinutes',
  'axisPaddingMinutes',
  'minimumBarWidthPercent',
  'hoursAxisLabelLimitMinutes',
  'weekAxisLabelLimitMinutes',
  'hourMinutes',
  'dayMinutes',
  'tickCountSafetyBound',
  'dateAndClockLength',
  'calendarDateLength',
  'monthAndDaySliceStart',
  'clockSliceStart',
  'clockSliceEnd',
] as const;

/** Unrecognised properties are accepted: the progress file gains fields over time and a stricter check would blank the chart on that upgrade. */
export function pagePayloadFrom(value: unknown): PagePayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const { progress, limits } = value;
  const generatedAtEpochMilliseconds = numberOrNull(value['generatedAtEpochMilliseconds']);
  if (!isRecord(progress) || !isRecord(limits) || generatedAtEpochMilliseconds === null) {
    return null;
  }
  if (typeof progress['trackerId'] !== 'string' || typeof progress['startedAt'] !== 'string') {
    return null;
  }
  if (!Array.isArray(progress['tasks']) || !Array.isArray(progress['log']) || !isRecord(progress['view'])) {
    return null;
  }
  const ladder = limits['tickStepLadderMinutes'];
  if (!Array.isArray(ladder) || ladder.some((step) => numberOrNull(step) === null)) {
    return null;
  }
  if (REQUIRED_LIMIT_NAMES.some((name) => numberOrNull(limits[name]) === null)) {
    return null;
  }
  return value as unknown as PagePayload;
}

/** Drops an unusable entry instead of failing the whole island, which is the opposite direction from `pagePayloadFrom`. */
export function pageTicketsFrom(value: unknown): PageTicket[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is PageTicket => isRecord(entry)
    && typeof entry['id'] === 'string'
    && typeof entry['title'] === 'string'
    && typeof entry['status'] === 'string'
    && typeof entry['bodyHtml'] === 'string');
}

/** `file://` is one origin in Chrome, so the tracker id is what keeps two dashboards' ranges apart. */
export function storageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}`;
}

export function storedOverrideFrom(value: unknown): StoredViewOverride {
  if (!isRecord(value)) {
    return EMPTY_VIEW_OVERRIDE;
  }
  return {
    presetKey:   textOrNull(value['presetKey']),
    fromText:    textOrNull(value['fromText']),
    toText:      textOrNull(value['toText']),
    tickMinutes: numberOrNull(value['tickMinutes']),
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
  const automatic = computeTimeline({
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
