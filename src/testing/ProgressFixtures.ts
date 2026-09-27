/**
 * A new tracker's progress and a row filed the way the Board files one, for the adapter and service specs that read or write progress.json.
 * Test-only: nothing that ships may import `src/testing/`.
 */
import type { Task }                       from '../lib/tracker-model/@types/Task.ts';
import type { TrackerProgress }            from '../lib/tracker-model/@types/TrackerProgress.ts';
import { EmptyProgressUtil }               from '../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { TaskFilingUtil, type TaskFiling } from '../lib/tracker-model/utils/TaskFilingUtil.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';

export function emptyProgress(): TrackerProgress {
  return EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: FILED_AT, trackerId: 'example-tracker-id' });
}

/** Files a row the way the Board does, so a document read back holds exactly what a command would have written. */
export function fileRow(progress: TrackerProgress, filing: TaskFiling): Task {
  const task          = TaskFilingUtil.filedTaskOf(progress.nextTaskId, filing);
  progress.nextTaskId = task.id + 1;
  progress.tasks.push(task);
  return task;
}
