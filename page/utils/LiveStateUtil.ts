/** The one rule for which work an agent is at now, which every view's pulse follows: a build or a review running. */

import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';

const LIVE_DISPLAY_STATES: ReadonlySet<DisplayState> = new Set(['in-progress', 'reviewing', 're-review']);

function displayStateIsLive(state: DisplayState): boolean {
  return LIVE_DISPLAY_STATES.has(state);
}

/** ` data-live` on a live item's element, else nothing. */
function liveAttributeOf(state: DisplayState): string {
  return displayStateIsLive(state) ? ' data-live' : '';
}

export const LiveStateUtil = { displayStateIsLive, liveAttributeOf } as const;
