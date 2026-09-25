/** The one verb that moves a row or a ticket to each status; a ticket's statuses are a subset of a row's, so one table serves both. */
import type { TaskStatus } from '../../lib/tracker-model/@types/Task.ts';

export const VERB_FOR_STATUS: Readonly<Record<TaskStatus, string>> = {
  'pending':     'reopen',
  'in-progress': 'start',
  'paused':      'pause',
  'in-review':   'finish',
  're-review':   'rereview',
  'reviewed':    'approve',
  'delivered':   'deliver',
  'abandoned':   'abandon',
};
