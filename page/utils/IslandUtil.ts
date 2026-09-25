import type { PagePayload, PageTicket } from '../../src/shared/@types/PagePayload.ts';
import { JsonValueUtil }                from './JsonValueUtil.ts';

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
  'doneWorkVisibleMilliseconds',
] as const;

/** Unrecognised properties are accepted: the progress file gains fields over time and a stricter check would blank the chart on that upgrade. */
function pagePayloadFrom(value: unknown): PagePayload | null {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return null;
  }
  const { progress, limits, concurrency } = value;
  const generatedAtEpochMilliseconds = JsonValueUtil.finiteNumberOrNull(value['generatedAtEpochMilliseconds']);
  if (!JsonValueUtil.valueIsRecord(progress) || !JsonValueUtil.valueIsRecord(limits) || generatedAtEpochMilliseconds === null) {
    return null;
  }
  if (!JsonValueUtil.valueIsRecord(concurrency)
    || JsonValueUtil.finiteNumberOrNull(concurrency['limit']) === null
    || JsonValueUtil.finiteNumberOrNull(concurrency['agentsInFlight']) === null) {
    return null;
  }
  if (typeof progress['trackerId'] !== 'string' || typeof progress['startedAt'] !== 'string') {
    return null;
  }
  if (!Array.isArray(progress['tasks']) || !Array.isArray(progress['log']) || !JsonValueUtil.valueIsRecord(progress['view'])) {
    return null;
  }
  const ladder = limits['tickStepLadderMinutes'];
  if (!Array.isArray(ladder) || ladder.some((step) => JsonValueUtil.finiteNumberOrNull(step) === null)) {
    return null;
  }
  if (REQUIRED_LIMIT_NAMES.some((name) => JsonValueUtil.finiteNumberOrNull(limits[name]) === null)) {
    return null;
  }
  return value as unknown as PagePayload;
}

/** Drops an unusable entry instead of failing the whole island, which is the opposite direction from `pagePayloadFrom`. */
function pageTicketsFrom(value: unknown): PageTicket[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is PageTicket => JsonValueUtil.valueIsRecord(entry)
    && typeof entry['id'] === 'string'
    && typeof entry['title'] === 'string'
    && typeof entry['status'] === 'string'
    && typeof entry['bodyHtml'] === 'string');
}

export const IslandUtil = {
  pagePayloadFrom,
  pageTicketsFrom,
} as const;
