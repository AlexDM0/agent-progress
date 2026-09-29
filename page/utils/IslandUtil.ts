import type { Task }      from '../../src/lib/tracker-model/@types/Task.ts';
import { VocabularyUtil } from '../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import type {
  PageBoardFacts,
  PagePayload,
  PageTicket,
  PageTicketFacts,
} from '../../src/shared/@types/PagePayload.ts';
import type { BoardRow, BoardTicket, PageBoard } from '../@types/PageBoard.ts';
import { JsonValueUtil }                         from './JsonValueUtil.ts';

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

function rowPositionIsValid(value: unknown, rowCount: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < rowCount;
}

function displayStateIsKnown(value: unknown): boolean {
  return typeof value === 'string' && (value === 'reviewing' || VocabularyUtil.taskStatusIsKnown(value));
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
  const { reviewBarPositions, waitingOnTicketIds } = value;
  return typeof value['ticketId'] === 'string'
    && (value['ownRowPosition'] === null || rowPositionIsValid(value['ownRowPosition'], rowCount))
    && Array.isArray(reviewBarPositions)
    && reviewBarPositions.every((position) => rowPositionIsValid(position, rowCount))
    && displayStateIsKnown(value['displayState'])
    && Array.isArray(waitingOnTicketIds)
    && waitingOnTicketIds.every((ticketId) => typeof ticketId === 'string');
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

function rowAt(rows: readonly BoardRow[], position: number | null): BoardRow | null {
  return position === null ? null : rows[position] ?? null;
}

/**
 * The facts must have passed `pagePayloadFrom`. A ticket the facts do not name is dropped, like an unusable entry. Ticket files a hand edit gave
 * one id take that id's facts entries in turn, as the render wrote both lists, and any beyond them the first.
 */
function pageBoardFrom(tasks: readonly Task[], boardFacts: PageBoardFacts, tickets: readonly PageTicket[]): PageBoard {
  const rows = tasks.map((task, position): BoardRow => {
    const rowFacts = boardFacts.rows[position];
    return {
      ...task,
      displayState:                 rowFacts?.displayState ?? task.status,
      deliveredRowCountsAsReviewed: rowFacts?.deliveredRowCountsAsReviewed ?? false,
      ownRowOfReviewedTicket:       null,
    };
  });
  rows.forEach((row, position) => {
    row.ownRowOfReviewedTicket = rowAt(rows, boardFacts.rows[position]?.ownRowPositionOfReviewedTicket ?? null);
  });

  const ticketFactsById = new Map<string, PageTicketFacts[]>();
  for (const ticketFacts of boardFacts.tickets) {
    ticketFactsById.set(ticketFacts.ticketId, [...(ticketFactsById.get(ticketFacts.ticketId) ?? []), ticketFacts]);
  }
  const ticketsSeenById = new Map<string, number>();
  const boardTickets = tickets.flatMap((ticket): BoardTicket[] => {
    const factsEntries    = ticketFactsById.get(ticket.id) ?? [];
    const timesSeenBefore = ticketsSeenById.get(ticket.id) ?? 0;
    ticketsSeenById.set(ticket.id, timesSeenBefore + 1);
    const ticketFacts = factsEntries[timesSeenBefore] ?? factsEntries[0];
    if (ticketFacts === undefined) return [];
    return [{
      ...ticket,
      ownRow:       rowAt(rows, ticketFacts.ownRowPosition),
      reviewBars:   ticketFacts.reviewBarPositions.flatMap((position) => rows[position] ?? []),
      displayState: ticketFacts.displayState,
      waitingOn:    ticketFacts.waitingOnTicketIds,
    }];
  });

  return { rows, tickets: boardTickets };
}

export const IslandUtil = {
  pagePayloadFrom,
  pageTicketsFrom,
  pageBoardFrom,
} as const;
