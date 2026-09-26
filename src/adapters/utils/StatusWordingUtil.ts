/** The one wording of each status, ticket type, priority and dispatcher state the command line prints, as a word, a verb and the state a move reached. */
import type { DispatcherState }            from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { TaskStatus }                 from '../../lib/tracker-model/@types/Task.ts';
import type { TicketPriority, TicketType } from '../../lib/tracker-model/@types/Ticket.ts';

/** Abandoning is worded with its reason, never as a bare phrase, so it has no moved phrase. */
export type MovedToStatus = Exclude<TaskStatus, 'abandoned'>;

// A ticket's statuses are a subset of a row's, so one table serves both.
const STATUS_WORD_FOR_STATUS: Readonly<Record<TaskStatus, string>> = {
  'pending':     'pending',
  'in-progress': 'in-progress',
  'paused':      'paused',
  'in-review':   'in-review',
  're-review':   're-review',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
  'abandoned':   'abandoned',
};

const TICKET_TYPE_WORD_FOR_TYPE: Readonly<Record<TicketType, string>> = {
  bug:     'bug',
  change:  'change',
  feature: 'feature',
};

const PRIORITY_WORD_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = {
  low:    'low',
  normal: 'normal',
  high:   'high',
};

const DISPATCHER_STATE_WORD_FOR_STATE: Readonly<Record<DispatcherState, string>> = {
  running:  'running',
  finished: 'finished',
  stopped:  'stopped',
};

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

function statusWordFor(status: TaskStatus): string {
  return STATUS_WORD_FOR_STATUS[status];
}

function ticketTypeWordFor(type: TicketType): string {
  return TICKET_TYPE_WORD_FOR_TYPE[type];
}

function priorityWordFor(priority: TicketPriority): string {
  return PRIORITY_WORD_FOR_PRIORITY[priority];
}

function dispatcherStateWordFor(state: DispatcherState): string {
  return DISPATCHER_STATE_WORD_FOR_STATE[state];
}

function verbFor(status: TaskStatus): string {
  return VERB_FOR_STATUS[status];
}

function movedPhraseFor(status: MovedToStatus): string {
  return MOVED_PHRASE_FOR_STATUS[status];
}

export const StatusWordingUtil = {
  statusWordFor,
  ticketTypeWordFor,
  priorityWordFor,
  dispatcherStateWordFor,
  verbFor,
  movedPhraseFor,
} as const;
