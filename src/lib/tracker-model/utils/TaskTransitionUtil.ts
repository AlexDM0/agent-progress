import type { Task, TaskStatus }     from '../@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND } from '../constants/ReviewRounds.ts';

/**
 * An existing timestamp is never overwritten, which is what makes re-running a command safe — and a phase is filed only when the
 * status really moved, `re-review` excepted, because every review round is an event of its own on a row that does not change status.
 * The record comes back new: existing keys keep their place and new ones follow in the stored file's key order, so a rewrite leaves
 * the bytes of untouched rows unchanged.
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

export const TaskTransitionUtil = { transitionedTaskOf } as const;
