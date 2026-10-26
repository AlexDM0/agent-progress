/**
 * The activity banner's markup. The cases that matter: no agent prints the one idle line; a builder and a reviewer carry the chart's own
 * state colours; a free-standing row has no ticket id; values are escaped; and the elapsed time is hidden from the live region, so a tick is
 * never announced. The embedded stale notice takes its minutes from the one live age limit, never a second literal.
 */

import { describe, expect, test }  from 'bun:test';
import { MILLISECONDS_PER_MINUTE } from '../../src/lib/local-time/LocalTimeUtil.ts';
import { EXAMPLE_PAGE_LIMITS }     from '../testing/PageLimitsFixture.ts';
import {
  activityBannerMarkup,
  IDLE_ACTIVITY_TEXT,
  STALE_NOTICE_TEXT,
  staleNoticeMarkup
} from './ActivityBannerMarkup.ts';
import type { ActivityEntry }                                  from './utils/ActivityBannerUtil.ts';
import { LIVE_AGE_LIMIT_MILLISECONDS, LIVE_AGE_LIMIT_MINUTES } from './utils/HeaderFigureUtil.ts';

const START = 1_000_000;

function exampleEntry(changes: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    taskId: 1, kind: 'building', ticketId: '060', title: 'Account pages dark mode', startEpochMilliseconds: START, ...changes
  };
}

describe('staleNoticeMarkup', () => {
  test('names the live age limit in one banner row with a dot', () => {
    expect(STALE_NOTICE_TEXT).toBe(`Not updated for the last ${LIVE_AGE_LIMIT_MINUTES} minutes`);
    expect(LIVE_AGE_LIMIT_MILLISECONDS).toBe(LIVE_AGE_LIMIT_MINUTES * MILLISECONDS_PER_MINUTE);
    expect(staleNoticeMarkup()).toBe('<div class="ap-activity-row"><span class="ap-activity-dot" aria-hidden="true"></span>'
      + `<span class="ap-activity-title">${STALE_NOTICE_TEXT}</span></div>`);
  });
});

describe('activityBannerMarkup', () => {
  test('prints the idle line when no agent works', () => {
    expect(activityBannerMarkup([], START, EXAMPLE_PAGE_LIMITS)).toBe(`<div class="ap-activity-idle">${IDLE_ACTIVITY_TEXT}</div>`);
    expect(IDLE_ACTIVITY_TEXT).toBe('No agent is working right now.');
  });

  test('prints a builder in the in-progress state and a reviewer in the reviewing state, in the order given', () => {
    const markup = activityBannerMarkup([exampleEntry(), exampleEntry({ taskId: 2, kind: 'reviewing', ticketId: '059' })], START + 42_000, EXAMPLE_PAGE_LIMITS);

    expect([...markup.matchAll(/data-state="([^"]*)"/g)].map((match) => match[1])).toEqual(['in-progress', 'reviewing']);
    expect([...markup.matchAll(/<span class="ap-activity-kind">([^<]*)</g)].map((match) => match[1])).toEqual(['Building', 'Reviewing']);
    expect(markup).toContain('<span class="ap-activity-id">#060</span>');
    expect(markup).toContain('<span class="ap-activity-elapsed" aria-hidden="true">42s</span>');
  });

  test('omits the ticket id of a free-standing row and escapes the title', () => {
    const markup = activityBannerMarkup([exampleEntry({ ticketId: null, title: 'Fix <b> & "quotes"' })], START, EXAMPLE_PAGE_LIMITS);

    expect(markup).not.toContain('ap-activity-id');
    expect(markup).toContain('title="Fix &lt;b&gt; &amp; &quot;quotes&quot;">Fix &lt;b&gt; &amp; &quot;quotes&quot;</span>');
  });
});
