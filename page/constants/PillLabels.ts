import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';

/**
 * Every label names the state the row is actually in, and `done` means merged: a repeat review carries its round number, which
 * `pillLabelForDisplayState` appends, and the rest are the label as written.
 */
export const PILL_LABEL_FOR_DISPLAY_STATE: Readonly<Record<DisplayState, string>> = {
  'pending':     'unstarted',
  'in-progress': 'wip',
  'paused':      'paused',
  'in-review':   'awaiting review',
  'reviewing':   'reviewing',
  're-review':   'reviewing',
  'reviewed':    'awaiting merge',
  'delivered':   'done',
  'abandoned':   'abandoned',
};
