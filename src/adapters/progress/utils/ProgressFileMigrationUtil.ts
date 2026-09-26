/** The retired task status words of a validated progress.json replaced by their current ones, on copies: the input is never changed. */
import type { TaskStatus }                                        from '../../../lib/tracker-model/@types/Task.ts';
import { VocabularyUtil }                                         from '../../../lib/tracker-model/utils/VocabularyUtil.ts';
import { LegacyStatusUtil }                                       from '../../utils/LegacyStatusUtil.ts';
import type { StoredTask, StoredTaskPhase, StoredTaskStatusWord } from '../@types/StoredProgressFile.ts';

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

export const ProgressFileMigrationUtil = { tasksInCurrentWords } as const;
