import type { TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';

export type RowState = TaskStatus | 'reviewing';

/**
 * Every label names the state the row is actually in, and `done` means merged: a repeat review carries its round number, which
 * `pillLabelForRowState` appends, and the rest are the label as written.
 */
export const PILL_LABEL_FOR_ROW_STATE: Readonly<Record<RowState, string>> = {
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
