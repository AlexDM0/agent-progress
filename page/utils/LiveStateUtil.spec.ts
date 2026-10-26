/**
 * The live rule every view's pulse reads. What matters: a running build or review is live in either round, and awaiting review, pending,
 * paused and every settled state are not, so a ticket waiting for its reviewer never pulses.
 */

import { describe, expect, test } from 'bun:test';
import type { DisplayState }      from '../../src/lib/tracker-model/@types/Task.ts';
import { LiveStateUtil }          from './LiveStateUtil.ts';

const LIVE: DisplayState[]     = ['in-progress', 'reviewing', 're-review'];
const NOT_LIVE: DisplayState[] = ['pending', 'paused', 'in-review', 'reviewed', 'delivered', 'abandoned'];

describe('the live rule', () => {
  test.each(LIVE)('%s is live and carries data-live', (state) => {
    expect(LiveStateUtil.displayStateIsLive(state)).toBe(true);
    expect(LiveStateUtil.liveAttributeOf(state)).toBe(' data-live');
  });

  test.each(NOT_LIVE)('%s is not live and carries nothing', (state) => {
    expect(LiveStateUtil.displayStateIsLive(state)).toBe(false);
    expect(LiveStateUtil.liveAttributeOf(state)).toBe('');
  });
});

describe('the template pulse', () => {
  const PULSE_KEYFRAMES = /animation: ap-(?:card-flare|card-sheen|state-ring)\b/;

  test('runs only on a data-live mark, only while the page is live, only with motion allowed', async () => {
    const templateText  = await Bun.file(`${import.meta.dir}/../../resources/template.html`).text();
    const motionBlocks  = templateText.split('@media (prefers-reduced-motion: no-preference) {').slice(1).map((block) => block.split('\n}\n')[0] ?? '');
    const pulseRules    = motionBlocks.flatMap((block) => block.split('}')).filter((rule) => PULSE_KEYFRAMES.test(rule));
    const allPulseCount = templateText.split('\n').filter((line) => PULSE_KEYFRAMES.test(line)).length;

    expect(pulseRules.length).toBe(allPulseCount);
    expect(pulseRules.length).toBeGreaterThanOrEqual(3);
    for (const rule of pulseRules) {
      const selectors = rule.slice(0, rule.indexOf('{')).split(/,\s*\n/).map((selector) => selector.trim()).filter((selector) => selector !== '');
      for (const selector of selectors) {
        expect(selector).toStartWith(':root[data-freshness="live"]');
        expect(selector).toContain('[data-live]');
      }
    }
  });
});
