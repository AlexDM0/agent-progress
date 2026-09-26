/**
 * Progress documents for the progress.json adapter specs: a new tracker, a row filed the way the Board files one, and the tracker as the
 * current format stores it. Test-only: nothing that ships may import `src/adapters/progress/testing/`.
 */
import type { ProgressFile }               from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { Task }                       from '../../../lib/tracker-model/@types/Task.ts';
import { EmptyProgressUtil }               from '../../../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { TaskFilingUtil, type TaskFiling } from '../../../lib/tracker-model/utils/TaskFilingUtil.ts';
import type { StoredProgressFile }         from '../@types/StoredProgressFile.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';

export function emptyProgress(): ProgressFile {
  return EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: FILED_AT, trackerId: 'example-tracker-id' });
}

/** Files a row the way the Board does, so a document read back holds exactly what a command would have written. */
export function fileRow(progress: ProgressFile, filing: TaskFiling): Task {
  const task          = TaskFilingUtil.filedTaskOf(progress.nextTaskId, filing);
  progress.nextTaskId = task.id + 1;
  progress.tasks.push(task);
  return task;
}

/** The progress as the writer stores it, `version` first; the tasks array is the progress's own, so a row filed on either shows in both. */
export function versionTwoDocumentOf(progress: ProgressFile): StoredProgressFile {
  return { version: 2, ...progress };
}

export function emptyDocument(): StoredProgressFile {
  return versionTwoDocumentOf(emptyProgress());
}
