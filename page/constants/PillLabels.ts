import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';

/**
 * Every label names the state the row is actually in, and `done` means merged: a repeat review carries its round number, which
 * `pillLabelForDisplayState` appends. A state not listed here is labelled as itself.
 */
export const PILL_LABEL_FOR_DISPLAY_STATE: Readonly<Partial<Record<DisplayState, string>>> = {
  'pending':     'unstarted',
  'in-progress': 'wip',
  'in-review':   'awaiting review',
  're-review':   'reviewing',
  'reviewed':    'awaiting merge',
  'delivered':   'done',
};
