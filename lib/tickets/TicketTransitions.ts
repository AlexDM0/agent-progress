/**
 * What a ticket's status change means: which timestamp it writes and which status its Gantt row
 * takes. Nothing here writes a file, takes a lock or checks legality — the caller holds the lock,
 * and the named verbs consult `LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS` before transitioning.
 */

import { FIRST_REPEAT_REVIEW_ROUND }     from '../constants/Limits.ts';
import { TASK_STATUS_FOR_TICKET_STATUS } from '../constants/Statuses.ts';
import type {
  ProgressFile,
  Task,
  TaskStatus,
  Ticket,
  TicketFrontmatter,
  TicketStatus,
} from '../constants/Types.ts';

export interface AddTaskInput {
  name:      string;
  owner?:    string;
  note?:     string;
  ticket?:   string;
  status?:   TaskStatus;
  start?:    string;
  end?:      string;
  reviewed?: string;
}

export interface ProgressOperations {
  addTask:        (progress: ProgressFile, input: AddTaskInput) => Task;
  findTask:       (progress: ProgressFile, taskId: number) => Task | undefined;
  transitionTask: (progress: ProgressFile, taskId: number, status: TaskStatus, at: string) => 'applied' | 'no-such-task';
  appendLogEntry: (progress: ProgressFile, at: string, text: string) => void;
}

export interface TicketRowInput {
  progress:   ProgressFile;
  ticket:     Ticket;
  operations: ProgressOperations;
}

export interface ApplyTicketRereviewInput {
  progress:   ProgressFile;
  ticket:     Ticket;
  at:         string;
  operations: ProgressOperations;
}

export interface ApplyTicketTransitionInput {
  progress:     ProgressFile;
  ticket:       Ticket;
  targetStatus: TicketStatus;
  at:           string;
  operations:   ProgressOperations;
  branch?:      string;
  commit?:      string;
  reason?:      string;
}

export type ApplyTicketTransitionResult =
  | { verdict: 'applied'; ticket: Ticket; logText: string }
  | { verdict: 'refused'; reason: string };

/** `open` reads as `reopened`: the first `open` is logged by `ticket add` instead. */
const LOG_PHRASE_FOR_TICKET_STATUS: Record<TicketStatus, string> = {
  open:          'reopened',
  'in-progress': 'started',
  'in-review':   'in review',
  done:          'done',
  delivered:     'delivered',
  abandoned:     'abandoned',
};

const ABANDON_WITHOUT_REASON_REFUSAL = 'abandon needs --reason';

const REREVIEW_FROM_ELSEWHERE_REFUSAL = 'another review pass needs a ticket that is in-review';

/**
 * Read as "to reach the key, the ticket has to be in one of these"; no row holds its own key, so a move to the current
 * status is never legal. `applyTicketRereview` is the one move deliberately outside this table.
 */
export const LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS: Record<TicketStatus, readonly TicketStatus[]> = {
  'open':        ['in-progress', 'in-review', 'done', 'delivered', 'abandoned'],
  'in-progress': ['open', 'in-review'],
  'in-review':   ['in-progress'],
  'done':        ['in-progress', 'in-review'],
  'delivered':   ['done'],
  'abandoned':   ['open', 'in-progress', 'in-review', 'done'],
};

export function ticketMoveIsLegal(currentStatus: TicketStatus, targetStatus: TicketStatus): boolean {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].includes(currentStatus);
}

/** An existing row comes back untouched, so a row `ticket link --force` deliberately moved is never taken back. */
export function ensureTaskForTicket(input: TicketRowInput): Task {
  const { progress, ticket, operations } = input;
  const { frontmatter }                  = ticket;
  const linkedTask                       = frontmatter.task === null ? undefined : operations.findTask(progress, frontmatter.task);

  if (linkedTask !== undefined) {
    return linkedTask;
  }

  const created = operations.addTask(progress, {
    name:   taskNameFor(frontmatter),
    ticket: frontmatter.id,
    status: 'pending',
  });

  frontmatter.task = created.id;
  return created;
}

/** `started`, `finished` and `delivered` are set only when still null, while `abandonedAt` is always set: abandoning twice is deciding twice. */
export function applyTicketTransition(input: ApplyTicketTransitionInput): ApplyTicketTransitionResult {
  const {
    progress,
    ticket,
    targetStatus,
    at,
    operations,
  } = input;
  const { frontmatter } = ticket;

  if (targetStatus === 'abandoned' && (input.reason === undefined || input.reason.trim() === '')) {
    return { verdict: 'refused', reason: ABANDON_WITHOUT_REASON_REFUSAL };
  }

  frontmatter.status  = targetStatus;
  frontmatter.updated = at;
  applyTimestampsFor(frontmatter, targetStatus, at);

  if (input.branch !== undefined) {
    frontmatter.branch = input.branch;
  }
  if (input.commit !== undefined) {
    frontmatter.commit = input.commit;
  }
  if (input.reason !== undefined) {
    frontmatter.reason = input.reason;
  }

  const task = ensureTaskForTicket({ progress, ticket, operations });
  // The row was just found or created, so `no-such-task` cannot come back.
  operations.transitionTask(progress, task.id, TASK_STATUS_FOR_TICKET_STATUS[targetStatus], at);

  const logText = logTextFor(frontmatter, targetStatus);
  operations.appendLogEntry(progress, at, logText);

  return { verdict: 'applied', ticket, logText };
}

/**
 * The one move that leaves a ticket in the status it already has: a second reviewer is still review,
 * so only `updated` is stamped and the row counts the round. It is why this is not a matrix entry.
 */
export function applyTicketRereview(input: ApplyTicketRereviewInput): ApplyTicketTransitionResult {
  const {
    progress,
    ticket,
    at,
    operations,
  } = input;
  const { frontmatter } = ticket;

  if (frontmatter.status !== 'in-review') {
    return { verdict: 'refused', reason: REREVIEW_FROM_ELSEWHERE_REFUSAL };
  }

  frontmatter.updated = at;

  const task = ensureTaskForTicket({ progress, ticket, operations });
  operations.transitionTask(progress, task.id, 're-review', at);

  const logText = `Ticket #${frontmatter.id} in review, round ${task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND}`;
  operations.appendLogEntry(progress, at, logText);

  return { verdict: 'applied', ticket, logText };
}

/**
 * The bar ends at `finished` before `delivered`, because delivery is a later fact about finished work rather than more of it.
 * A done or delivered ticket was reviewed, since delivery is only legal from `done`.
 */
export function seedTaskFromTicket(input: TicketRowInput): Task {
  const { progress, ticket, operations } = input;
  const { frontmatter }                  = ticket;
  const endTimestamp                     = frontmatter.finished ?? frontmatter.delivered ?? frontmatter.abandonedAt;

  const seeded = operations.addTask(progress, {
    name:   taskNameFor(frontmatter),
    ticket: frontmatter.id,
    status: TASK_STATUS_FOR_TICKET_STATUS[frontmatter.status],
    ...(frontmatter.started === null ? {} : { start: frontmatter.started }),
    ...(endTimestamp === null ? {} : { end: endTimestamp }),
    ...(frontmatter.status === 'done' || frontmatter.status === 'delivered' ? { reviewed: frontmatter.finished ?? frontmatter.updated } : {}),
  });

  frontmatter.task = seeded.id;
  return seeded;
}

function applyTimestampsFor(frontmatter: TicketFrontmatter, targetStatus: TicketStatus, at: string): void {
  switch (targetStatus) {
    case 'open':
      frontmatter.started     = null;
      frontmatter.finished    = null;
      frontmatter.delivered   = null;
      frontmatter.abandonedAt = null;
      delete frontmatter.reason;
      break;
    case 'in-progress':
      frontmatter.started ??= at;
      break;
    case 'in-review':
    case 'done':
      frontmatter.finished ??= at;
      break;
    case 'delivered':
      frontmatter.delivered ??= at;
      break;
    case 'abandoned':
      frontmatter.abandonedAt = at;
      break;
  }
}

function logTextFor(frontmatter: TicketFrontmatter, targetStatus: TicketStatus): string {
  const headline = `Ticket #${frontmatter.id} ${LOG_PHRASE_FOR_TICKET_STATUS[targetStatus]}`;
  return targetStatus === 'abandoned' ? `${headline}: ${frontmatter.reason ?? ''}` : headline;
}

function taskNameFor(frontmatter: TicketFrontmatter): string {
  return `#${frontmatter.id} ${frontmatter.title}`;
}
