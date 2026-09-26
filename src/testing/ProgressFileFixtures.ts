/**
 * Progress documents for the progress.json adapter specs: a new tracker, a row filed the way the Board files one, the tracker stored in either
 * version, and a document written before the task statuses were renamed. Test-only: nothing that ships may import `src/testing/`.
 */
import type { StoredLogEntry, StoredProgressFileVersionOne, StoredProgressFileVersionTwo } from '../adapters/progress/@types/StoredProgressFile.ts';
import type { ProgressFile }                                                               from '../lib/tracker-model/@types/ProgressFile.ts';
import type { Task, TaskStatus }                                                           from '../lib/tracker-model/@types/Task.ts';
import { EmptyProgressUtil }                                                               from '../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { TaskFilingUtil, type TaskFiling }                                                 from '../lib/tracker-model/utils/TaskFilingUtil.ts';

const FILED_AT    = '2026-09-18T20:11:03+02:00';
const STARTED_AT  = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

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
export function versionTwoDocumentOf(progress: ProgressFile): StoredProgressFileVersionTwo<TaskStatus> {
  return { version: 2, ...progress };
}

/** The progress as a build before log.jsonl stored it, with its log after `tasks`, where a file `init` created keeps it. */
export function versionOneDocumentOf(progress: ProgressFile, log: StoredLogEntry[] = []): StoredProgressFileVersionOne<TaskStatus> {
  return { version: 1, ...progress, log };
}

export function emptyDocument(): StoredProgressFileVersionTwo<TaskStatus> {
  return versionTwoDocumentOf(emptyProgress());
}

/** A file written before the task statuses were renamed: it keeps the retired words on purpose, in its rows and in their history. */
export function documentInRetiredWords(): StoredProgressFileVersionOne {
  const progress = emptyProgress();
  const building  = fileRow(progress, { name: 'Example build' });
  const reviewing = fileRow(progress, { name: 'Example review' });
  return {
    ...versionOneDocumentOf(progress),
    tasks: [
      {
        ...building,
        status:  'running',
        history: [{ status: 'pending', at: FILED_AT }, { status: 'running', at: STARTED_AT }],
      },
      {
        ...reviewing,
        status:  'finished',
        history: [{ status: 'running', at: STARTED_AT }, { status: 'finished', at: FINISHED_AT }],
      },
    ],
  };
}
