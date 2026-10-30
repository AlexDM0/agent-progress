/**
 * When each open ticket, and so each wave, is expected to be done: a p50 and a p80 finish forecast from the board's own settled history,
 * the slot limit and the dependencies played forward. DOM-free and clock-free: now arrives as a parameter, and the forecast is only shown.
 */

import type { TaskPhase, TaskStatus }                    from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority, TicketSize, TicketStatus } from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY }      from '../../src/lib/tracker-model/constants/Statuses.ts';
import { TimeUtil }                                      from './TimeUtil.ts';

/** From this many delivered tickets of one size on, a ticket of that size draws on those alone. */
export const MINIMUM_SIZED_SAMPLES = 8;

const MEDIAN_QUANTILE      = 0.5;
const PESSIMISTIC_QUANTILE = 0.8;

export interface ForecastRow {
  status:   TaskStatus;
  history?: readonly TaskPhase[];
}

export interface ForecastTicket {
  id:         string;
  status:     TicketStatus;
  priority?:  TicketPriority;
  size?:      TicketSize;
  hold?:      string;
  dependsOn?: readonly string[];
  ownRow:     ForecastRow | null;
  reviewBars: readonly ForecastRow[];
}

export interface FinishForecast {
  p50FinishEpochMilliseconds: number;
  p80FinishEpochMilliseconds: number;
}

export interface ForecastSituation {
  concurrencyLimit:     number;
  /** Started first when slots are scarce, as the waves order them. */
  pacePathTicketIds:    readonly string[];
  nowEpochMilliseconds: number;
}

interface PassHistory {
  buildMilliseconds:  readonly number[];
  reviewMilliseconds: readonly number[];
  reviewPassCounts:   readonly number[];
}

interface PhaseSpans {
  settledMilliseconds:        number[];
  /** How long the row's current in-progress phase has run, or null when it is not in one. */
  runningElapsedMilliseconds: number | null;
}

/** Linear interpolation between the two nearest ranks; null for no samples. */
function percentileOf(samples: readonly number[], quantile: number): number | null {
  if (samples.length === 0) return null;
  const sorted   = samples.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower    = sorted[Math.floor(position)] ?? 0;
  const upper    = sorted[Math.ceil(position)] ?? lower;
  return lower + (upper - lower) * (position - Math.floor(position));
}

/**
 * What is left of a pass that has run `elapsed`: only past passes at least that long count, so a pass past the usual length is given a
 * longer remainder. A pass longer than every past one is given another whole typical pass.
 */
function remainderOf(samples: readonly number[], elapsedMilliseconds: number, quantile: number): number | null {
  const atLeastAsLong = samples.filter((sample) => sample >= elapsedMilliseconds);
  if (atLeastAsLong.length === 0) return percentileOf(samples, quantile);
  return (percentileOf(atLeastAsLong, quantile) ?? elapsedMilliseconds) - elapsedMilliseconds;
}

function inProgressSpansOf(row: ForecastRow, nowEpochMilliseconds: number): PhaseSpans {
  const history = row.history ?? [];
  const spans: PhaseSpans = { settledMilliseconds: [], runningElapsedMilliseconds: null };
  history.forEach((phase, index) => {
    if (phase.status !== 'in-progress') return;
    const startedAt = TimeUtil.epochMillisecondsOf(phase.at);
    if (startedAt === null) return;
    const nextPhase = history[index + 1];
    if (nextPhase === undefined) {
      if (row.status === 'in-progress') spans.runningElapsedMilliseconds = Math.max(0, nowEpochMilliseconds - startedAt);
      return;
    }
    const endedAt = TimeUtil.epochMillisecondsOf(nextPhase.at);
    if (endedAt !== null && endedAt >= startedAt) spans.settledMilliseconds.push(endedAt - startedAt);
  });
  return spans;
}

function passHistoryOf(deliveredTickets: readonly ForecastTicket[], nowEpochMilliseconds: number): PassHistory {
  return {
    buildMilliseconds:  deliveredTickets.flatMap((ticket) => (ticket.ownRow === null ? [] : inProgressSpansOf(ticket.ownRow, nowEpochMilliseconds).settledMilliseconds)),
    reviewMilliseconds: deliveredTickets.flatMap((ticket) => ticket.reviewBars.flatMap((bar) => inProgressSpansOf(bar, nowEpochMilliseconds).settledMilliseconds)),
    reviewPassCounts:   deliveredTickets.map((ticket) => ticket.reviewBars.length),
  };
}

/** The work left on one ticket at one quantile, or null when the history holds no build pass to forecast from. */
function remainingMillisecondsOf(ticket: ForecastTicket, history: PassHistory, quantile: number, nowEpochMilliseconds: number): number | null {
  const wholeBuild = percentileOf(history.buildMilliseconds, quantile);
  if (wholeBuild === null) return null;
  const wholeReview      = percentileOf(history.reviewMilliseconds, quantile) ?? 0;
  const expectedReviews  = Math.round(percentileOf(history.reviewPassCounts, quantile) ?? 0);

  if (ticket.status === 'in-review') {
    const barSpans       = ticket.reviewBars.map((bar) => inProgressSpansOf(bar, nowEpochMilliseconds));
    const runningElapsed = barSpans.find((spans) => spans.runningElapsedMilliseconds !== null)?.runningElapsedMilliseconds ?? null;
    const reviewsLeft    = Math.max(1, expectedReviews - barSpans.filter((spans) => spans.runningElapsedMilliseconds === null).length);
    if (runningElapsed === null) return reviewsLeft * wholeReview;
    return (remainderOf(history.reviewMilliseconds, runningElapsed, quantile) ?? 0) + (reviewsLeft - 1) * wholeReview;
  }
  const runningElapsed = ticket.status === 'in-progress' && ticket.ownRow !== null
    ? inProgressSpansOf(ticket.ownRow, nowEpochMilliseconds).runningElapsedMilliseconds
    : null;
  const buildLeft = runningElapsed === null ? wholeBuild : remainderOf(history.buildMilliseconds, runningElapsed, quantile) ?? wholeBuild;
  return buildLeft + expectedReviews * wholeReview;
}

function ticketIsOpen(ticket: ForecastTicket): boolean {
  return ticket.status !== 'abandoned' && !TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY.includes(ticket.status);
}

function ticketIsRunning(ticket: ForecastTicket): boolean {
  return ticket.status === 'in-progress' || ticket.status === 'in-review';
}

/**
 * Plays the open tickets forward at one quantile: a running ticket holds a slot from now, a pending one starts once its dependencies are
 * done and a slot is free, low priority last, then the pace path, then the lowest id. A held ticket never starts or finishes, nor does one
 * waiting on it; a held or paused one holds no slot.
 */
function finishesAt(
  openTickets: readonly ForecastTicket[],
  remainingOf: (ticket: ForecastTicket) => number | null,
  situation: ForecastSituation,
): Map<string, number | null> {
  const finishById   = new Map<string, number | null>();
  const openIds      = new Set(openTickets.map((ticket) => ticket.id));
  const startOrder   = (ticket: ForecastTicket): [number, number, number] => [
    Number(ticket.priority === 'low'),
    Number(!situation.pacePathTicketIds.includes(ticket.id)),
    Number(ticket.id),
  ];
  let waiting = openTickets.filter((ticket) => !ticketIsRunning(ticket)).toSorted((a, b) => {
    const [orderA, orderB] = [startOrder(a), startOrder(b)];
    return orderA[0] - orderB[0] || orderA[1] - orderB[1] || orderA[2] - orderB[2];
  });
  let busyUntil: number[] = [];
  let clock               = situation.nowEpochMilliseconds;

  for (const ticket of openTickets.filter(ticketIsRunning)) {
    if (ticket.hold !== undefined || ticket.ownRow?.status === 'paused') {
      finishById.set(ticket.id, null);
      continue;
    }
    const remaining = remainingOf(ticket);
    const finish    = remaining === null ? null : clock + remaining;
    finishById.set(ticket.id, finish);
    if (finish !== null) busyUntil.push(finish);
  }
  for (const ticket of waiting.filter((candidate) => candidate.hold !== undefined)) finishById.set(ticket.id, null);
  waiting = waiting.filter((ticket) => ticket.hold === undefined);

  const openDependenciesOf = (ticket: ForecastTicket): string[] => (ticket.dependsOn ?? []).filter((dependencyId) => openIds.has(dependencyId));
  while (waiting.length > 0) {
    busyUntil = busyUntil.filter((finish) => finish > clock);
    const blocked = waiting.filter((ticket) => openDependenciesOf(ticket).some((dependencyId) => finishById.get(dependencyId) === null));
    for (const ticket of blocked) finishById.set(ticket.id, null);
    waiting = waiting.filter((ticket) => !blocked.includes(ticket));

    const startable = waiting.filter((ticket) => openDependenciesOf(ticket).every((dependencyId) => {
      const dependencyFinish = finishById.get(dependencyId);
      return dependencyFinish !== undefined && dependencyFinish !== null && dependencyFinish <= clock;
    }));
    const started = startable.slice(0, Math.max(0, situation.concurrencyLimit - busyUntil.length));
    for (const ticket of started) {
      const remaining = remainingOf(ticket);
      const finish    = remaining === null ? null : clock + remaining;
      finishById.set(ticket.id, finish);
      if (finish !== null) busyUntil.push(finish);
    }
    waiting = waiting.filter((ticket) => !started.includes(ticket));
    if (started.length > 0 || blocked.length > 0) continue;

    const later = [...busyUntil, ...[...finishById.values()].flatMap((finish) => (finish !== null && finish > clock ? [finish] : []))];
    if (later.length === 0) break;
    clock = Math.min(...later);
  }
  for (const ticket of waiting) finishById.set(ticket.id, null);
  return finishById;
}

/** Each open ticket's p50 and p80 finish, or null when it is held, waits on one that is, or the history holds nothing to forecast from. */
function ticketFinishForecastsOf(tickets: readonly ForecastTicket[], situation: ForecastSituation): Map<string, FinishForecast | null> {
  const delivered   = tickets.filter((ticket) => ticket.status === 'delivered');
  const allHistory  = passHistoryOf(delivered, situation.nowEpochMilliseconds);
  const historyOf   = (ticket: ForecastTicket): PassHistory => {
    const sameSize = ticket.size === undefined ? [] : delivered.filter((candidate) => candidate.size === ticket.size);
    return sameSize.length >= MINIMUM_SIZED_SAMPLES ? passHistoryOf(sameSize, situation.nowEpochMilliseconds) : allHistory;
  };
  const openTickets = tickets.filter(ticketIsOpen);
  const finishesAtQuantile = (quantile: number): Map<string, number | null> => finishesAt(
    openTickets,
    (ticket) => remainingMillisecondsOf(ticket, historyOf(ticket), quantile, situation.nowEpochMilliseconds),
    situation,
  );
  const medianFinishes      = finishesAtQuantile(MEDIAN_QUANTILE);
  const pessimisticFinishes = finishesAtQuantile(PESSIMISTIC_QUANTILE);
  return new Map(openTickets.map((ticket) => {
    const p50Finish = medianFinishes.get(ticket.id) ?? null;
    const p80Finish = pessimisticFinishes.get(ticket.id) ?? null;
    return [ticket.id, p50Finish === null || p80Finish === null
      ? null
      : { p50FinishEpochMilliseconds: p50Finish, p80FinishEpochMilliseconds: Math.max(p50Finish, p80Finish) }] as const;
  }));
}

/** The latest finish among a wave's tickets, or null when one of them is held, paused or has no forecast. */
function waveFinishForecastOf(
  waveTicketIds: readonly string[],
  ticketById: ReadonlyMap<string, ForecastTicket>,
  forecastById: ReadonlyMap<string, FinishForecast | null>,
): FinishForecast | null {
  const forecasts: FinishForecast[] = [];
  for (const ticketId of waveTicketIds) {
    const ticket   = ticketById.get(ticketId);
    const forecast = forecastById.get(ticketId) ?? null;
    if (ticket === undefined || ticket.hold !== undefined || ticket.ownRow?.status === 'paused' || forecast === null) return null;
    forecasts.push(forecast);
  }
  if (forecasts.length === 0) return null;
  return {
    p50FinishEpochMilliseconds: Math.max(...forecasts.map((forecast) => forecast.p50FinishEpochMilliseconds)),
    p80FinishEpochMilliseconds: Math.max(...forecasts.map((forecast) => forecast.p80FinishEpochMilliseconds)),
  };
}

export const WaveForecastUtil = {
  percentileOf, remainderOf, ticketFinishForecastsOf, waveFinishForecastOf
} as const;
