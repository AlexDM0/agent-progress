/**
 * The activity banner's markup. The cases that matter: no agent prints the one idle line; a builder and a reviewer carry the chart's own
 * state colours; a free-standing row has no ticket id; values are escaped; and the elapsed time is hidden from the live region, so a tick is
 * never announced.
 */

import { describe, expect, test }                   from 'bun:test';
import { EXAMPLE_PAGE_LIMITS }                      from '../testing/PageLimitsFixture.ts';
import { activityBannerMarkup, IDLE_ACTIVITY_TEXT } from './ActivityBannerMarkup.ts';
import type { ActivityEntry }                       from './utils/ActivityBannerUtil.ts';

const START = 1_000_000;

function exampleEntry(changes: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    taskId: 1, kind: 'building', ticketId: '060', title: 'Account pages dark mode', startEpochMilliseconds: START, ...changes
  };
}

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
