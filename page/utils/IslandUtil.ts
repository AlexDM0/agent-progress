import type { PagePayload, PageTicket } from '../../src/shared/@types/PagePayload.ts';
import { PILL_LABEL_FOR_DISPLAY_STATE } from '../constants/PillLabels.ts';
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

function rowPositionIsValid(value: unknown, rowCount: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < rowCount;
}

function displayStateIsKnown(value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(PILL_LABEL_FOR_DISPLAY_STATE, value);
}

function rowFactsAreValid(value: unknown, rowCount: number): boolean {
  return JsonValueUtil.valueIsRecord(value)
    && displayStateIsKnown(value['displayState'])
    && typeof value['deliveredRowCountsAsReviewed'] === 'boolean'
    && (value['ownRowPositionOfReviewedTicket'] === null || rowPositionIsValid(value['ownRowPositionOfReviewedTicket'], rowCount));
}

function ticketFactsAreValid(value: unknown, rowCount: number): boolean {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return false;
  }
  const { reviewBarPositions } = value;
  return typeof value['ticketId'] === 'string'
    && (value['ownRowPosition'] === null || rowPositionIsValid(value['ownRowPosition'], rowCount))
    && Array.isArray(reviewBarPositions)
    && reviewBarPositions.every((position) => rowPositionIsValid(position, rowCount))
    && displayStateIsKnown(value['displayState']);
}

function boardFactsAreValid(value: unknown, rowCount: number): boolean {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return false;
  }
  const { rows, tickets } = value;
  return Array.isArray(rows)
    && rows.length === rowCount
    && rows.every((rowFacts) => rowFactsAreValid(rowFacts, rowCount))
    && Array.isArray(tickets)
    && tickets.every((ticketFacts) => ticketFactsAreValid(ticketFacts, rowCount));
}

/**
 * Unrecognised properties are accepted: the progress file gains fields over time and a stricter check would blank the chart on that upgrade.
 * The Board facts are checked in full, one row fact per task and every position inside the tasks, since each fact is read by position.
 */
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
  if (!boardFactsAreValid(value['boardFacts'], progress['tasks'].length)) {
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
