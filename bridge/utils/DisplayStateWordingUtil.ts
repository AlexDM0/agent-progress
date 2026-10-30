/** How the Bridge words a display state, as the static page's badges do; the state itself is the Board's fact, never the Bridge's. */
import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';

const STATE_LABEL_FOR_DISPLAY_STATE: Readonly<Record<DisplayState, string>> = {
  'draft':       'Draft',
  'pending':     'To do',
  'in-progress': 'In progress',
  'paused':      'Paused',
  'in-review':   'Awaiting review',
  'reviewing':   'Reviewing',
  're-review':   'Reviewing',
  'reviewed':    'Awaiting merge',
  'delivered':   'Done',
  'abandoned':   'Abandoned',
};

function labelOf(state: DisplayState): string {
  return STATE_LABEL_FOR_DISPLAY_STATE[state];
}

/** A repeat review names its round: `Reviewing (round 2)`. */
function stateLabelOf(state: DisplayState, reviewRound: number): string {
  return state === 're-review' ? `${labelOf(state)} (round ${reviewRound})` : labelOf(state);
}

export const DisplayStateWordingUtil = Object.freeze({ labelOf, stateLabelOf });
