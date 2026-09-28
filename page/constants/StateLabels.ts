import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';

/**
 * The one word for each state on every tab, and `Done` means merged. A repeat review carries its round, which
 * `WorkItemMarkupUtil.stateLabelOf` appends.
 */
export const STATE_LABEL_FOR_DISPLAY_STATE: Readonly<Record<DisplayState, string>> = {
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
