/** A row's record as filed and as each move leaves it. */
import type { Task, TaskPhase, TaskStatus } from '../@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }        from '../constants/ReviewRounds.ts';

export interface TaskFiling {
  name:            string;
  owner?:          string;
  note?:           string;
  ticket?:         string | null;
  status?:         TaskStatus;
  start?:          string | null;
  end?:            string | null;
  tokens?:         number | null;
  reviewed?:       string;
  reviewRound?:    number;
  reviewOf?:       string;
  reviewBarRound?: number;
  /** When the row was filed. It is the stamp a `pending` row's first phase carries, and the only way the queue interval is ever measurable. */
  filedAt?:        string;
}

/** The statuses whose moment is the row's `end` rather than its `start`, which is what a seeded phase is stamped at. */
const TASK_STATUSES_THAT_CLOSE_THE_BAR: readonly TaskStatus[] = ['in-review', 're-review', 'reviewed', 'delivered', 'abandoned'];

/**
 * The stamp follows the status: a phase that opens the row's interval is stamped where it opens, a terminal one where it closes, and a
 * `pending` row is stamped where it was filed. A caller that supplied no stamp at all leaves the row with nothing to record.
 */
function seededHistoryFor(filing: TaskFiling): TaskPhase[] | null {
  const status = filing.status ?? 'pending';
  if (status === 'pending') {
    return filing.filedAt === undefined ? null : [{ status, at: filing.filedAt }];
  }
  const reachedAt = TASK_STATUSES_THAT_CLOSE_THE_BAR.includes(status) ? filing.end ?? filing.start : filing.start ?? filing.end;
  return reachedAt === undefined || reachedAt === null ? null : [{ status, at: reachedAt }];
}

/** The optional fields are written only when given, in this order, which is the key order the stored file keeps. */
function filedTaskOf(taskId: number, filing: TaskFiling): Task {
  const seededHistory = seededHistoryFor(filing);
  return {
    id:     taskId,
    name:   filing.name,
    status: filing.status ?? 'pending',
    start:  filing.start ?? null,
    end:    filing.end ?? null,
    owner:  filing.owner ?? '',
    note:   filing.note ?? '',
    ticket: filing.ticket ?? null,
    tokens: filing.tokens ?? null,
    ...(filing.reviewed === undefined ? {} : { reviewed: filing.reviewed }),
    ...(filing.reviewRound === undefined ? {} : { reviewRound: filing.reviewRound }),
    ...(seededHistory === null ? {} : { history: seededHistory }),
    ...(filing.reviewOf === undefined ? {} : { reviewOf: filing.reviewOf }),
    ...(filing.reviewBarRound === undefined ? {} : { reviewBarRound: filing.reviewBarRound }),
  };
}

/**
 * An existing timestamp is never overwritten, so repeating a move is safe, and a phase is filed only when the status really moved,
 * `re-review` excepted. The record comes back new, its existing keys in place and new ones in the stored key order.
 */
function transitionedTaskOf(task: Readonly<Task>, status: TaskStatus, at: string): Task {
  const transitioned: Task = { ...task };
  const statusMoved        = task.status !== status;

  // A row that starts work anew is its own agent until a claim keys it again; only a resumed pause is still the same agent.
  if (status === 'in-progress' && task.status !== 'in-progress' && task.status !== 'paused') delete transitioned.agent;

  if (status === 'in-progress' || status === 'paused') {
    transitioned.start = task.start ?? at;
    transitioned.end   = null;
  } else if (status === 'in-review' || status === 're-review' || status === 'reviewed' || status === 'delivered') {
    transitioned.start = task.start ?? at;
    transitioned.end   = task.end ?? at;
    if (status === 're-review') transitioned.reviewRound = task.reviewRound === undefined ? FIRST_REPEAT_REVIEW_ROUND : task.reviewRound + 1;
    if (status === 'reviewed') transitioned.reviewed = task.reviewed ?? at;
  } else if (status === 'abandoned') {
    if (task.start !== null) transitioned.end = task.end ?? at;
  } else {
    transitioned.start = null;
    transitioned.end   = null;
    delete transitioned.reviewed;
    delete transitioned.reviewRound;
  }

  if (statusMoved || status === 're-review') transitioned.history = [...(task.history ?? []), { status, at }];

  transitioned.status = status;
  return transitioned;
}

export const TaskRecordUtil = { filedTaskOf, transitionedTaskOf } as const;
