/** The one wording of each status as a verb and as the state a move reached, shared by the CLI and the log. */
import type { TaskStatus } from '../../lib/tracker-model/@types/Task.ts';

/** Abandoning is worded with its reason, never as a bare phrase, so it has no moved phrase. */
export type MovedToStatus = Exclude<TaskStatus, 'abandoned'>;

// A ticket's statuses are a subset of a row's, so one table serves both.
const VERB_FOR_STATUS: Readonly<Record<TaskStatus, string>> = {
  'pending':     'reopen',
  'in-progress': 'start',
  'paused':      'pause',
  'in-review':   'finish',
  're-review':   'rereview',
  'reviewed':    'approve',
  'delivered':   'deliver',
  'abandoned':   'abandon',
};

const MOVED_PHRASE_FOR_STATUS: Readonly<Record<MovedToStatus, string>> = {
  'pending':     'reopened',
  'in-progress': 'started',
  'paused':      'paused',
  'in-review':   'in review',
  're-review':   'under review again',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
};

function verbFor(status: TaskStatus): string {
  return VERB_FOR_STATUS[status];
}

function movedPhraseFor(status: MovedToStatus): string {
  return MOVED_PHRASE_FOR_STATUS[status];
}

export const StatusWordingUtil = { verbFor, movedPhraseFor } as const;
