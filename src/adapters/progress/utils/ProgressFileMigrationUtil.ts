/**
 * A validated progress.json brought up to date on copies, so the input is never changed: the retired task status words replaced by their
 * current ones, and a version 1 file's worded log turned into note records.
 */
import type { LogRecord }   from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { TaskStatus }  from '../../../lib/tracker-model/@types/Task.ts';
import { VocabularyUtil }   from '../../../lib/tracker-model/utils/VocabularyUtil.ts';
import { LegacyStatusUtil } from '../../utils/LegacyStatusUtil.ts';
import type {
  StoredLogEntry,
  StoredTask,
  StoredTaskPhase,
  StoredTaskStatusWord
} from '../@types/StoredProgressFile.ts';

function currentStatusOf(status: StoredTaskStatusWord): TaskStatus {
  if (VocabularyUtil.taskStatusIsKnown(status)) return status;
  const replacement = LegacyStatusUtil.currentTaskStatusFor(status);
  // Validation lets only current and retired words through, so this is a broken invariant, not a bad file.
  if (replacement === null) throw new Error(`the status word ${JSON.stringify(status)} passed validation without a replacement`);
  return replacement;
}

/** In memory only: a read never writes, so a file keeps its retired words until the next command that changes it stores the new ones. */
function tasksInCurrentWords(tasks: readonly StoredTask[]): StoredTask<TaskStatus>[] {
  return tasks.map((task) => {
    // Typed without the two fields that hold words, though the object keeps them, so the spread overwrites them in the file's key order.
    const fieldsWithoutWords: Omit<StoredTask, 'status' | 'history'> = task;
    const history: StoredTaskPhase<TaskStatus>[] | undefined = task.history?.map((phase) => ({ ...phase, status: currentStatusOf(phase.status) }));
    return {
      ...fieldsWithoutWords,
      status: currentStatusOf(task.status),
      ...(history === undefined ? {} : { history }),
    };
  });
}

/** A sentence cannot be parsed back into the event it words, so each one is kept as a note, in order, with its stamp. */
function notesOf(entries: readonly StoredLogEntry[]): LogRecord[] {
  return entries.map((entry) => ({ at: entry.at, kind: 'note', fields: { text: entry.text } }));
}

export const ProgressFileMigrationUtil = { tasksInCurrentWords, notesOf } as const;
