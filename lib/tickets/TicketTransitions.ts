/**
 * What a ticket's status change means: which timestamp it writes and which status its Gantt row
 * takes. Nothing here writes a file, takes a lock or checks legality — the caller holds the lock, and the
 * named verbs consult `src/lib/tracker-model/constants/TicketMoveLegality.ts` before transitioning; `applyTicketRereview`
 * is the one move deliberately outside that table.
 */

import type { ProgressFile }     from '../../src/lib/tracker-model/@types/ProgressFile.ts';
import type { Task, TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';
import type {
  Ticket,
  TicketFrontmatter,
  TicketPriority,
  TicketStatus
} from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil } from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import { LIMITS }             from '../../src/shared/constants/Limits.ts';

export interface AddTaskInput {
  name:      string;
  owner?:    string;
  note?:     string;
  ticket?:   string;
  status?:   TaskStatus;
  start?:    string;
  end?:      string;
  reviewed?: string;
  filedAt?:  string;
}

export interface ProgressOperations {
  addTask:        (progress: ProgressFile, input: AddTaskInput) => Task;
  findTask:       (progress: ProgressFile, taskId: number) => Task | undefined;
  transitionTask: (progress: ProgressFile, taskId: number, status: TaskStatus, at: string) => 'applied' | 'no-such-task';
  appendLogEntry: (progress: ProgressFile, at: string, text: string) => void;
}

/** Only a priority change removes a row, so only it asks for the one extra operation. */
export interface PriorityOperations extends ProgressOperations {
  removeTask: (progress: ProgressFile, taskId: number) => Task | undefined;
}

export interface TicketRowInput {
  progress:   ProgressFile;
  ticket:     Ticket;
  operations: ProgressOperations;
}

/** `at` is used only when there is no row yet: a row a ticket files is filed at that moment, which is the first phase of its history. */
export interface EnsureTaskForTicketInput extends TicketRowInput {
  at: string;
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

export interface ApplyTicketPriorityInput {
  progress:   ProgressFile;
  ticket:     Ticket;
  priority:   TicketPriority;
  at:         string;
  operations: PriorityOperations;
}

export type ApplyTicketTransitionResult =
  | { verdict: 'applied'; ticket: Ticket; logText: string }
  | { verdict: 'refused'; reason: string };

/** `pending` reads as `reopened`: the first `pending` is logged by `ticket add` instead. */
const LOG_PHRASE_FOR_TICKET_STATUS: Record<TicketStatus, string> = {
  pending:       'reopened',
  'in-progress': 'started',
  'in-review':   'in review',
  reviewed:      'reviewed',
  delivered:     'delivered',
  abandoned:     'abandoned',
};

const ABANDON_WITHOUT_REASON_REFUSAL = 'abandon needs --reason';

const REREVIEW_FROM_ELSEWHERE_REFUSAL = 'another review pass needs a ticket that is in-review';

/** A low ticket that was never started lives off the chart; once started it keeps the row it was given. */
const TICKET_STATUSES_A_LOW_TICKET_WAITS_OFF_THE_CHART_IN: readonly TicketStatus[] = ['pending', 'abandoned'];

const LOWERING_A_TICKET_THAT_IS_NOT_PENDING_REFUSAL = 'only a pending ticket can be lowered to low, since a low ticket has no row until it is started';

/** An existing row comes back untouched, so a row `ticket link --force` deliberately moved is never taken back. */
export function ensureTaskForTicket(input: EnsureTaskForTicketInput): Task {
  const { progress, ticket, operations } = input;
  const { frontmatter }                  = ticket;
  const linkedTask                       = frontmatter.task === null ? undefined : operations.findTask(progress, frontmatter.task);

  if (linkedTask !== undefined) {
    return linkedTask;
  }

  const created = operations.addTask(progress, {
    name:    taskNameFor(frontmatter),
    ticket:  frontmatter.id,
    status:  'pending',
    filedAt: input.at,
  });

  frontmatter.task = created.id;
  return created;
}

export function ticketStaysOffTheChart(frontmatter: TicketFrontmatter): boolean {
  return TicketDefaultsUtil.ticketPriorityOf(frontmatter) === 'low'
    && frontmatter.started === null
    && TICKET_STATUSES_A_LOW_TICKET_WAITS_OFF_THE_CHART_IN.includes(frontmatter.status);
}

/** `ensureTaskForTicket`, except that a row-less ticket staying off the chart is given no row and `null` comes back. */
export function ensureTaskForTicketOnTheChart(input: EnsureTaskForTicketInput): Task | null {
  const { progress, ticket, operations } = input;
  const { frontmatter }                  = ticket;
  const linkedTask                       = frontmatter.task === null ? undefined : operations.findTask(progress, frontmatter.task);

  if (linkedTask === undefined && ticketStaysOffTheChart(frontmatter)) {
    return null;
  }
  return ensureTaskForTicket(input);
}

/**
 * Lowering to low is refused unless the ticket is pending, and removes its row; raising a low ticket gives it a row at once — seeded from its
 * stamps when it is no longer pending, the way `clear` would, so an abandoned ticket does not come back as a pending bar.
 */
export function applyTicketPriority(input: ApplyTicketPriorityInput): ApplyTicketTransitionResult {
  const {
    progress,
    ticket,
    priority,
    at,
    operations,
  } = input;
  const { frontmatter } = ticket;
  const current         = TicketDefaultsUtil.ticketPriorityOf(frontmatter);

  if (current === priority) {
    return { verdict: 'refused', reason: `it is already ${priority} priority` };
  }
  if (priority === 'low' && frontmatter.status !== 'pending') {
    return { verdict: 'refused', reason: LOWERING_A_TICKET_THAT_IS_NOT_PENDING_REFUSAL };
  }

  frontmatter.priority = priority;
  const linkedTask     = frontmatter.task === null ? undefined : operations.findTask(progress, frontmatter.task);

  if (priority === 'low') {
    if (linkedTask !== undefined) operations.removeTask(progress, linkedTask.id);
    frontmatter.task = null;
  } else if (linkedTask === undefined && frontmatter.status === 'pending') {
    ensureTaskForTicket({
      progress,
      ticket,
      operations,
      at,
    });
  } else if (linkedTask === undefined) {
    seedTaskFromTicket({ progress, ticket, operations });
  }

  const logText = `Ticket #${frontmatter.id} priority ${current} → ${priority}`;
  operations.appendLogEntry(progress, at, logText);
  return { verdict: 'applied', ticket, logText };
}

/**
 * `started`, `finished` and `delivered` are set only when still null, while `abandonedAt` is always set: abandoning twice is deciding twice.
 * A low ticket without a row that is reopened or abandoned before it was ever started stays without one.
 */
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

  const task = ensureTaskForTicketOnTheChart({
    progress,
    ticket,
    operations,
    at,
  });
  // The row was just found or created, so `no-such-task` cannot come back.
  if (task !== null) operations.transitionTask(progress, task.id, targetStatus, at);

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

  const task = ensureTaskForTicket({
    progress,
    ticket,
    operations,
    at,
  });
  operations.transitionTask(progress, task.id, 're-review', at);

  const logText = `Ticket #${frontmatter.id} in review, round ${task.reviewRound ?? LIMITS.FIRST_REPEAT_REVIEW_ROUND}`;
  operations.appendLogEntry(progress, at, logText);

  return { verdict: 'applied', ticket, logText };
}

/**
 * The bar ends at `finished` before `delivered`, because delivery is a later fact about finished work rather than more of it.
 * A reviewed or delivered ticket was reviewed, since delivery is only legal from `reviewed`.
 */
export function seedTaskFromTicket(input: TicketRowInput): Task {
  const { progress, ticket, operations } = input;
  const { frontmatter }                  = ticket;
  const endTimestamp                     = frontmatter.finished ?? frontmatter.delivered ?? frontmatter.abandonedAt;

  const seeded = operations.addTask(progress, {
    name:   taskNameFor(frontmatter),
    ticket: frontmatter.id,
    status: frontmatter.status,
    ...(frontmatter.started === null ? {} : { start: frontmatter.started }),
    ...(endTimestamp === null ? {} : { end: endTimestamp }),
    ...(frontmatter.status === 'reviewed' || frontmatter.status === 'delivered' ? { reviewed: frontmatter.finished ?? frontmatter.updated } : {}),
  });

  frontmatter.task = seeded.id;
  return seeded;
}

function applyTimestampsFor(frontmatter: TicketFrontmatter, targetStatus: TicketStatus, at: string): void {
  switch (targetStatus) {
    case 'pending':
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
    case 'reviewed':
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
