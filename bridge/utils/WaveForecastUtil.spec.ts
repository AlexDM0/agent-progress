/**
 * The wave forecast's rules. The cases that matter: a running pass's remainder is drawn only from past passes at least as long, so it grows
 * once the pass outlives the usual one; a size with enough delivered samples draws on those alone and one short of the minimum falls back
 * to every delivered ticket; the slot limit serialises independent tickets; a dependent starts only once its dependency finishes; and a
 * wave holding a held or paused ticket has no forecast.
 */
import { describe, expect, test } from 'bun:test';

import type { TicketSize }                         from '../../src/lib/tracker-model/@types/Ticket.ts';
import { MINIMUM_SIZED_SAMPLES, WaveForecastUtil } from './WaveForecastUtil.ts';
import type { ForecastTicket }                     from './WaveForecastUtil.ts';

const MINUTE = 60_000;
const NOW    = Date.parse('2026-10-01T12:00:00Z');
const HISTORY_START = Date.parse('2026-09-01T08:00:00Z');

function stampAt(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

let nextTicketNumber = 100;

function deliveredTicket(buildMinutes: number, size?: TicketSize): ForecastTicket {
  nextTicketNumber += 1;
  const started = HISTORY_START + nextTicketNumber * MINUTE * 1000;
  return {
    id:     String(nextTicketNumber),
    status: 'delivered',
    ...(size === undefined ? {} : { size }),
    ownRow: {
      status:  'delivered',
      history: [{ status: 'in-progress', at: stampAt(started) }, { status: 'in-review', at: stampAt(started + buildMinutes * MINUTE) }],
    },
    reviewBars: [],
  };
}

function pendingTicket(id: string, changes: Partial<ForecastTicket> = {}): ForecastTicket {
  return {
    id, status: 'pending', ownRow: { status: 'pending' }, reviewBars: [], ...changes
  };
}

function runningTicket(id: string, elapsedMinutes: number): ForecastTicket {
  return {
    id,
    status:     'in-progress',
    ownRow:     { status: 'in-progress', history: [{ status: 'in-progress', at: stampAt(NOW - elapsedMinutes * MINUTE) }] },
    reviewBars: [],
  };
}

function minutesUntilFinish(tickets: readonly ForecastTicket[], ticketId: string, concurrencyLimit = 3): { p50: number; p80: number } {
  const forecast = WaveForecastUtil.ticketFinishForecastsOf(tickets, { concurrencyLimit, pacePathTicketIds: [], nowEpochMilliseconds: NOW }).get(ticketId);
  if (forecast === undefined || forecast === null) throw new Error(`no forecast for #${ticketId}`);
  return { p50: (forecast.p50FinishEpochMilliseconds - NOW) / MINUTE, p80: (forecast.p80FinishEpochMilliseconds - NOW) / MINUTE };
}

const LONG_TAILED_BUILD_MINUTES = [10, 20, 30, 40, 50, 60, 70, 80, 200, 400];

describe('a running pass', () => {
  const history         = LONG_TAILED_BUILD_MINUTES.map((minutes) => deliveredTicket(minutes));
  const historyP50      = WaveForecastUtil.percentileOf(LONG_TAILED_BUILD_MINUTES, 0.5) ?? 0;
  const historyP80      = WaveForecastUtil.percentileOf(LONG_TAILED_BUILD_MINUTES, 0.8) ?? 0;
  const remainderAt     = (elapsedMinutes: number): number => minutesUntilFinish([...history, runningTicket('001', elapsedMinutes)], '001').p50;

  test('the history percentiles the cases below run against', () => {
    expect(historyP50).toBe(55);
    expect(historyP80).toBeCloseTo(104);
  });

  test('is given a larger remainder at three times the history p80 than at its p50', () => {
    expect(remainderAt(historyP50)).toBe(25);
    expect(remainderAt(historyP80 * 3)).toBeCloseTo(88);
    expect(remainderAt(historyP80 * 3)).toBeGreaterThan(remainderAt(historyP50));
  });

  test('is given a growing remainder once its elapsed time passes the history p80', () => {
    expect(remainderAt(historyP80 + 1)).toBeGreaterThan(remainderAt(historyP80 - 30));
  });

  test('past every pass the history holds, is given another whole typical pass', () => {
    expect(remainderAt(500)).toBe(historyP50);
  });
});

describe('the samples a sized ticket draws on', () => {
  const unsizedSlowHistory = Array.from({ length: 10 }, () => deliveredTicket(100));

  test(`${MINIMUM_SIZED_SAMPLES} delivered tickets of its size are used alone`, () => {
    const sizedHistory = Array.from({ length: MINIMUM_SIZED_SAMPLES }, () => deliveredTicket(10, 'S'));
    expect(minutesUntilFinish([...unsizedSlowHistory, ...sizedHistory, pendingTicket('001', { size: 'S' })], '001')).toEqual({ p50: 10, p80: 10 });
  });

  test(`${MINIMUM_SIZED_SAMPLES - 1} fall back to every delivered ticket`, () => {
    const sizedHistory = Array.from({ length: MINIMUM_SIZED_SAMPLES - 1 }, () => deliveredTicket(10, 'S'));
    expect(minutesUntilFinish([...unsizedSlowHistory, ...sizedHistory, pendingTicket('001', { size: 'S' })], '001')).toEqual({ p50: 100, p80: 100 });
  });

  test('an unsized ticket draws on every delivered ticket', () => {
    const sizedHistory = Array.from({ length: MINIMUM_SIZED_SAMPLES }, () => deliveredTicket(10, 'S'));
    expect(minutesUntilFinish([...unsizedSlowHistory, ...sizedHistory, pendingTicket('001')], '001').p50).toBe(100);
  });
});

describe('playing the board forward', () => {
  const history = Array.from({ length: 4 }, () => deliveredTicket(30));

  test('a concurrency limit of 1 serialises two independent tickets', () => {
    const tickets = [...history, pendingTicket('001'), pendingTicket('002')];
    expect(minutesUntilFinish(tickets, '001', 1).p50).toBe(30);
    expect(minutesUntilFinish(tickets, '002', 1).p50).toBe(60);
    expect(minutesUntilFinish(tickets, '002', 2).p50).toBe(30);
  });

  test('a dependent starts only after its dependency finishes, whatever slots are free', () => {
    const tickets = [...history, pendingTicket('001'), pendingTicket('002', { dependsOn: ['001'] })];
    expect(minutesUntilFinish(tickets, '002', 3).p50).toBe(60);
  });

  test('a reviewed dependency counts as done', () => {
    const tickets = [...history, pendingTicket('001', { status: 'reviewed' }), pendingTicket('002', { dependsOn: ['001'] })];
    expect(minutesUntilFinish(tickets, '002', 3).p50).toBe(30);
  });

  test('a held ticket and its dependents have no forecast', () => {
    const tickets  = [...history, pendingTicket('001', { hold: '' }), pendingTicket('002', { dependsOn: ['001'] })];
    const forecast = WaveForecastUtil.ticketFinishForecastsOf(tickets, { concurrencyLimit: 3, pacePathTicketIds: [], nowEpochMilliseconds: NOW });
    expect(forecast.get('001')).toBeNull();
    expect(forecast.get('002')).toBeNull();
  });

  test('a held or paused running ticket and its dependents have no forecast, and take no slot', () => {
    const heldInReview = { ...runningTicket('001', 10), status: 'in-review' as const, hold: '' };
    const pausedBuild  = { ...runningTicket('002', 10), ownRow: { status: 'paused' as const } };
    const tickets      = [...history, heldInReview, pausedBuild, pendingTicket('003', { dependsOn: ['001'] }), pendingTicket('004')];
    const forecast     = WaveForecastUtil.ticketFinishForecastsOf(tickets, { concurrencyLimit: 1, pacePathTicketIds: [], nowEpochMilliseconds: NOW });
    expect([forecast.get('001'), forecast.get('002'), forecast.get('003')]).toEqual([null, null, null]);
    expect(minutesUntilFinish(tickets, '004', 1).p50).toBe(30);
  });
});

describe('a wave forecast', () => {
  const history = Array.from({ length: 4 }, () => deliveredTicket(30));

  test('is the latest finish among its tickets, and none when one is held or paused', () => {
    const tickets      = [...history, pendingTicket('001'), runningTicket('002', 10), pendingTicket('003', { hold: 'waiting on Example Agency' })];
    const ticketById   = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    const forecastById = WaveForecastUtil.ticketFinishForecastsOf(tickets, { concurrencyLimit: 3, pacePathTicketIds: [], nowEpochMilliseconds: NOW });
    const paused       = { ...runningTicket('004', 10), ownRow: { status: 'paused' as const } };

    expect(WaveForecastUtil.waveFinishForecastOf(['001', '002'], ticketById, forecastById)?.p50FinishEpochMilliseconds).toBe(NOW + 30 * MINUTE);
    expect(WaveForecastUtil.waveFinishForecastOf(['001', '003'], ticketById, forecastById)).toBeNull();
    expect(WaveForecastUtil.waveFinishForecastOf(['004'], new Map([['004', paused]]), new Map([['004', forecastById.get('001') ?? null]]))).toBeNull();
  });
});
