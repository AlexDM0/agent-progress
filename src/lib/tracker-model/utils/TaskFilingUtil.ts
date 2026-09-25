import type { Task, TaskPhase, TaskStatus } from '../@types/Task.ts';

export interface TaskFiling {
  name:         string;
  owner?:       string;
  note?:        string;
  ticket?:      string | null;
  status?:      TaskStatus;
  start?:       string | null;
  end?:         string | null;
  tokens?:      number | null;
  reviewed?:    string;
  reviewRound?: number;
  reviewOf?:    string;
  /** When the row was filed. It is the stamp a `pending` row's first phase carries, and the only way the queue interval is ever measurable. */
  filedAt?:     string;
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

/** The optional fields are written only when given, in this order, which is the key order `progress.json` stores. */
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
  };
}

export const TaskFilingUtil = { filedTaskOf } as const;
