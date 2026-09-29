/**
 * The header's words. The cases that matter: the four statistics come in the design's order with the design's labels, every state figure is
 * a button naming the lane it opens while the token figure is plain text, a missing limit prints the running count alone, and a live page
 * leads with its age while a snapshot leads with its stamp.
 */

import { describe, expect, test }                                from 'bun:test';
import { MILLISECONDS_PER_MINUTE }                               from '../../src/lib/local-time/LocalTimeUtil.ts';
import { TimeUtil }                                              from '../utils/TimeUtil.ts';
import { freshnessLabel, freshnessText, headerStatisticsMarkup } from './HeaderMarkup.ts';
import type { HeaderStatistics }                                 from './utils/HeaderFigureUtil.ts';

const EXAMPLE_STATISTICS: HeaderStatistics = {
  runningTaskCount:    1,
  agentLimit:          6,
  deliveredTodayCount: 34,
  tokensToday:         358_200_000,
  waitingInQueueCount: 0,
};

describe('headerStatisticsMarkup', () => {
  test('prints agents working, delivered today, tokens today and waiting in queue, in that order', () => {
    const markup = headerStatisticsMarkup(EXAMPLE_STATISTICS);
    const labels = [...markup.matchAll(/<span class="ap-stat-label">([^<]*)<\/span>/g)].map((match) => match[1]);

    expect(labels).toEqual(['agents working', 'delivered today', 'tokens today', 'waiting in queue']);
    expect(markup).toContain('<span class="ap-stat-n">1 / 6</span>');
    expect(markup).toContain('<span class="ap-stat-n">34</span>');
    expect(markup).toContain('<span class="ap-stat-n">358.2M</span>');
  });

  // The statistics are navigation: each state figure opens its lane and says so to a screen reader, while the token total has no lane.
  test('makes each state figure a button for its Kanban lane and leaves the token figure plain text', () => {
    const markup = headerStatisticsMarkup(EXAMPLE_STATISTICS);

    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="progress" aria-label="Show 1 / 6 agents working on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="done" aria-label="Show 34 delivered today on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="todo" aria-label="Show 0 waiting in queue on Kanban">');
    expect(markup).toContain('<span class="ap-stat"><span class="ap-stat-n">358.2M</span><span class="ap-stat-label">tokens today</span></span>');
    expect(markup.match(/<button /g)).toHaveLength(3);
  });

  test('prints the running count alone when the limit is missing', () => {
    expect(headerStatisticsMarkup({ ...EXAMPLE_STATISTICS, agentLimit: null })).toContain('<span class="ap-stat-n">1</span><span class="ap-stat-label">agents working</span>');
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
