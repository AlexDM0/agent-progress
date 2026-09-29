/**
 * The header's four statistics and the page's freshness. The cases that matter: only an in-progress row with no end runs, "today" is the
 * stamp's own calendar date so yesterday's delivery and yesterday's tokens stay out, a running row's tokens count whatever day it started,
 * a missing limit stays missing, and the Live bound sits exactly at ten minutes.
 */

import { describe, expect, test }                        from 'bun:test';
import { MILLISECONDS_PER_MINUTE }                       from '../../../src/lib/local-time/LocalTimeUtil.ts';
import type { Task }                                     from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketFrontmatter }                        from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { EXAMPLE_PAGE_LIMITS, EXAMPLE_TIMESTAMP_SLICES } from '../../testing/PageLimitsFixture.ts';
import { HeaderFigureUtil, LIVE_AGE_LIMIT_MILLISECONDS } from './HeaderFigureUtil.ts';

const { statisticsOf, freshnessOf } = HeaderFigureUtil;

const TODAY     = '2026-09-19';
const YESTERDAY = '2026-09-18';

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   'Split the exporter into two passes',
    status: 'delivered',
    start:  `${YESTERDAY}T09:00:00+02:00`,
    end:    `${YESTERDAY}T10:00:00+02:00`,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

type TicketFacts = Pick<TicketFrontmatter, 'status' | 'delivered'>;

function statisticsFor(tasks: readonly Task[], tickets: readonly TicketFacts[], agentLimit: number | null = 6) {
  return statisticsOf({
    tasks, tickets, agentLimit, todayCalendarDate: TODAY, slices: EXAMPLE_TIMESTAMP_SLICES
  });
}

describe('statisticsOf', () => {
  test('counts as running only an in-progress row with no end', () => {
    const statistics = statisticsFor([
      exampleTask({ id: 1, status: 'in-progress', end: null }),
      exampleTask({ id: 2, status: 'in-progress', end: `${TODAY}T08:00:00+02:00` }),
      exampleTask({ id: 3, status: 'paused', end: null }),
      exampleTask({
        id: 4, status: 'pending', start: null, end: null
      }),
    ], []);

    expect(statistics.runningTaskCount).toBe(1);
    expect(statistics.agentLimit).toBe(6);
  });

  test('keeps a missing limit missing', () => {
    expect(statisticsFor([], [], null).agentLimit).toBeNull();
  });

  test('counts the tickets delivered on the viewer\'s day and none delivered yesterday or not at all', () => {
    const statistics = statisticsFor([], [
      { status: 'delivered', delivered: `${TODAY}T00:00:00+02:00` },
      { status: 'delivered', delivered: `${TODAY}T13:28:00+02:00` },
      { status: 'delivered', delivered: `${YESTERDAY}T23:59:00+02:00` },
      { status: 'reviewed', delivered: null },
    ]);

    expect(statistics.deliveredTodayCount).toBe(2);
  });

  test('sums the tokens of rows that ended today or still run, leaving out yesterday\'s and unreported ones', () => {
    const statistics = statisticsFor([
      exampleTask({ id: 1, end: `${TODAY}T09:00:00+02:00`, tokens: 1_200_000 }),
      exampleTask({
        id: 2, status: 'in-progress', start: `${YESTERDAY}T22:00:00+02:00`, end: null, tokens: 300_000
      }),
      exampleTask({ id: 3, end: `${YESTERDAY}T21:00:00+02:00`, tokens: 9_000_000 }),
      exampleTask({ id: 4, end: `${TODAY}T10:00:00+02:00`, tokens: null }),
    ], []);

    expect(statistics.tokensToday).toBe(1_500_000);
  });

  test('counts the pending tickets as waiting in the queue', () => {
    const statistics = statisticsFor([], [
      { status: 'pending', delivered: null },
      { status: 'pending', delivered: null },
      { status: 'in-progress', delivered: null },
    ]);

    expect(statistics.waitingInQueueCount).toBe(2);
  });

  test('reads an empty board as zero everywhere', () => {
    expect(statisticsFor([], [])).toEqual({
      runningTaskCount: 0, agentLimit: 6, deliveredTodayCount: 0, tokensToday: 0, waitingInQueueCount: 0
    });
  });
});

describe('freshnessOf', () => {
  const generatedAt = Date.parse(`${TODAY}T17:53:00+02:00`);
  const freshnessAfter = (minutes: number) => freshnessOf(generatedAt, generatedAt + minutes * MILLISECONDS_PER_MINUTE, EXAMPLE_PAGE_LIMITS);

  test('is live under ten minutes and a snapshot from ten on', () => {
    expect(LIVE_AGE_LIMIT_MILLISECONDS).toBe(10 * MILLISECONDS_PER_MINUTE);
    expect(freshnessAfter(9.99).isLive).toBe(true);
    expect(freshnessAfter(10).isLive).toBe(false);
  });

  test('names the age just now, in minutes, in hours, then in days', () => {
    expect(freshnessAfter(0.5).ageText).toBe('just now');
    expect(freshnessAfter(3).ageText).toBe('3 min ago');
    expect(freshnessAfter(59).ageText).toBe('59 min ago');
    expect(freshnessAfter(60).ageText).toBe('1 h ago');
    expect(freshnessAfter(23 * 60 + 59).ageText).toBe('23 h ago');
    expect(freshnessAfter(24 * 60).ageText).toBe('1 day ago');
    expect(freshnessAfter(2 * 24 * 60 + 5).ageText).toBe('2 days ago');
  });

  test('reads a page stamped ahead of the viewer\'s clock as live and just generated', () => {
    expect(freshnessAfter(-5)).toEqual({ isLive: true, ageText: 'just now' });
  });
});
