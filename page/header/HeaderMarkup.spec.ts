/**
 * The header's words. The cases that matter: the four statistics come in the design's order with the design's labels, every state figure is
 * a button naming the lane it opens while the token figure is plain text, a missing limit prints the running count alone, the embedded
 * summary line splits the running rows into building and reviewing and prints today's figures as the statistics do, and a live page
 * leads with its age while a snapshot leads with its stamp.
 */

import { describe, expect, test }  from 'bun:test';
import { MILLISECONDS_PER_MINUTE } from '../../src/lib/local-time/LocalTimeUtil.ts';
import { TimeUtil }                from '../utils/TimeUtil.ts';
import {
  freshnessLabel,
  freshnessText,
  headerStatisticsMarkup,
  summaryLineMarkup
} from './HeaderMarkup.ts';
import { trackerHeaderStatisticsOf, trackerSummaryLineOf } from './TrackerHeaderModel.ts';
import type { HeaderStatistics }                           from './utils/HeaderFigureUtil.ts';

const EXAMPLE_STATISTICS: HeaderStatistics = {
  runningTaskCount:    1,
  runningReviewCount:  0,
  agentLimit:          6,
  deliveredTodayCount: 34,
  tokensToday:         358_200_000,
  waitingInQueueCount: 0,
  pausedBuildCount:    0,
};

describe('summaryLineMarkup', () => {
  const statistics: HeaderStatistics = {
    ...EXAMPLE_STATISTICS, runningTaskCount: 3, runningReviewCount: 1, waitingInQueueCount: 6, pausedBuildCount: 2
  };
  const figuresOf = (markup: string): string[] => [...markup.matchAll(/<span class="ap-summary-line-n">([^<]*)<\/span><span class="ap-summary-line-label">([^<]*)<\/span>/g)]
    .map((match) => `${match[1]} ${match[2]}`);

  test('prints building, reviewing, waiting in queue and paused, then a spacer, then done today and tokens today', () => {
    const markup = summaryLineMarkup(trackerSummaryLineOf(statistics));

    expect(figuresOf(markup)).toEqual(['2 building', '1 reviewing', '6 waiting in queue', '2 paused', '34 done today', '358.2M tokens today']);
    expect(markup.indexOf('ap-summary-line-spacer')).toBeGreaterThan(markup.indexOf('paused'));
    expect(markup.indexOf('ap-summary-line-spacer')).toBeLessThan(markup.indexOf('done today'));
    expect(markup.match(/ap-summary-line-divider/g)).toHaveLength(1);
  });

  test('prints the done-today and tokens-today figures the statistics print', () => {
    const statisticsFigures = [...headerStatisticsMarkup(trackerHeaderStatisticsOf(statistics))
      .matchAll(/<span class="ap-stat-n">([^<]*)<\/span><span class="ap-stat-label">(done today|tokens today)<\/span>/g)]
      .map((match) => `${match[1]} ${match[2]}`);

    expect(figuresOf(summaryLineMarkup(trackerSummaryLineOf(statistics))).slice(-2)).toEqual(statisticsFigures);
  });

  test('gives each state its lane colour dot and the token figure none', () => {
    const dotStates = [...summaryLineMarkup(trackerSummaryLineOf(statistics)).matchAll(/class="ap-summary-line-dot" data-state="([^"]*)"/g)].map((match) => match[1]);

    expect(dotStates).toEqual(['in-progress', 'reviewing', 'pending', 'paused', 'delivered']);
  });
});

describe('headerStatisticsMarkup', () => {
  test('prints agents working, done today, tokens today and waiting in queue, in that order', () => {
    const markup = headerStatisticsMarkup(trackerHeaderStatisticsOf(EXAMPLE_STATISTICS));
    const labels = [...markup.matchAll(/<span class="ap-stat-label">([^<]*)<\/span>/g)].map((match) => match[1]);

    expect(labels).toEqual(['agents working', 'done today', 'tokens today', 'waiting in queue']);
    expect(markup).toContain('<span class="ap-stat-n">1 / 6</span>');
    expect(markup).toContain('<span class="ap-stat-n">34</span>');
    expect(markup).toContain('<span class="ap-stat-n">358.2M</span>');
  });

  // The statistics are navigation: each state figure opens its lane and says so to a screen reader, while the token total has no lane.
  test('makes each state figure a button for its Kanban lane and leaves the token figure plain text', () => {
    const markup = headerStatisticsMarkup(trackerHeaderStatisticsOf(EXAMPLE_STATISTICS));

    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="progress" aria-label="Show 1 / 6 agents working on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="done" aria-label="Show 34 done today on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="todo" aria-label="Show 0 waiting in queue on Kanban">');
    expect(markup).toContain('<span class="ap-stat"><span class="ap-stat-n">358.2M</span><span class="ap-stat-label">tokens today</span></span>');
    expect(markup.match(/<button /g)).toHaveLength(3);
  });

  test('adds a paused figure after agents working, opening the In progress lane, only while a build is paused', () => {
    const markup = headerStatisticsMarkup(trackerHeaderStatisticsOf({ ...EXAMPLE_STATISTICS, pausedBuildCount: 1 }));
    const labels = [...markup.matchAll(/<span class="ap-stat-label">([^<]*)<\/span>/g)].map((match) => match[1]);

    expect(labels).toEqual(['agents working', 'paused', 'done today', 'tokens today', 'waiting in queue']);
    expect(markup).toContain('<button type="button" class="ap-stat" data-state="paused" data-kanban-lane="progress" aria-label="Show 1 paused on Kanban">');
    expect(headerStatisticsMarkup(trackerHeaderStatisticsOf(EXAMPLE_STATISTICS))).not.toContain('paused');
  });

  test('prints the running count alone when the limit is missing', () => {
    expect(headerStatisticsMarkup(trackerHeaderStatisticsOf({ ...EXAMPLE_STATISTICS, agentLimit: null })))
      .toContain('<span class="ap-stat-n">1</span><span class="ap-stat-label">agents working</span>');
  });
});

describe('the status line', () => {
  const generatedAt = Date.UTC(2026, 8, 28, 15, 53, 0);
  const today       = TimeUtil.calendarDateOf(generatedAt);
  const clock       = TimeUtil.clockOf(new Date(generatedAt));

  test('names a live page Live and leads with its age, the full stamp as its title', () => {
    const text = freshnessText(generatedAt, { isLive: true, ageText: '3 min ago' }, today);

    expect(freshnessLabel({ isLive: true, ageText: '3 min ago' })).toBe('Live');
    expect(text.text).toBe(`generated 3 min ago · ${clock}`);
    expect(text.title).toBe(`generated ${TimeUtil.fullInstantText(generatedAt)}`);
  });

  test('names an old page Snapshot and leads with its stamp, dated when it is from another day', () => {
    const laterToday = TimeUtil.calendarDateOf(generatedAt + 2 * 1440 * MILLISECONDS_PER_MINUTE);
    const text       = freshnessText(generatedAt, { isLive: false, ageText: '2 days ago' }, laterToday);

    expect(freshnessLabel({ isLive: false, ageText: '2 days ago' })).toBe('Snapshot');
    expect(text.text).toBe(`generated ${TimeUtil.shortInstantText(generatedAt, laterToday)} · 2 days ago`);
    expect(text.text).toMatch(/^generated \d\d-\d\d \d\d:\d\d · 2 days ago$/);
  });
});
