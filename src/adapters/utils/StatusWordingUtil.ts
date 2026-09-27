/**
 * The command line's words for a status that differ from the value: the verb a refusal tells the reader to run, and the phrase a move
 * ends on. Every other status, type, priority and dispatcher state prints as its value.
 */
import type { TaskStatus } from '../../lib/tracker-model/@types/Task.ts';

/** Abandoning is worded with its reason, never as a bare phrase, so it has no moved phrase. */
export type MovedToStatus = Exclude<TaskStatus, 'abandoned'>;

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

const MOVED_PHRASE_FOR_STATUS: Readonly<Partial<Record<MovedToStatus, string>>> = {
  'pending':     'reopened',
  'in-progress': 'started',
  'in-review':   'in review',
  're-review':   'under review again',
};

function verbFor(status: TaskStatus): string {
  return VERB_FOR_STATUS[status];
}

function movedPhraseFor(status: MovedToStatus): string {
  return MOVED_PHRASE_FOR_STATUS[status] ?? status;
}

export const StatusWordingUtil = {
  verbFor,
  movedPhraseFor,
} as const;
