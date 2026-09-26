/** A validated progress.json, its words already current, mapped to the model; every key, unknown ones included, keeps the file's order. */
import type { ProgressFile }                 from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { TaskStatus }                   from '../../../lib/tracker-model/@types/Task.ts';
import type { StoredProgressFileVersionOne } from '../@types/StoredProgressFile.ts';

function progressOf(document: StoredProgressFileVersionOne<TaskStatus>): ProgressFile {
  return { ...document };
}

export const ProgressFileMappingUtil = { progressOf } as const;
