/**
 * A validated progress.json, its words already current, mapped to the model and back to the stored document. The model holds neither the
 * format's `version` nor its log; every other key, unknown ones included, keeps the file's order.
 */
import type { ProgressFile }                                     from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { TaskStatus }                                       from '../../../lib/tracker-model/@types/Task.ts';
import type { StoredProgressFile, StoredProgressFileVersionTwo } from '../@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION }                         from '../constants/ProgressFileVersions.ts';

const FORMAT_KEYS: readonly string[] = ['version', 'log'];

function progressOf(document: StoredProgressFile<TaskStatus>): ProgressFile {
  const progressEntries = Object.entries(document).filter(([key]) => !FORMAT_KEYS.includes(key));
  // A walk that keeps key order loses the types; it carries every key of the document but the format's own, which is what the model states.
  return Object.fromEntries(progressEntries) as unknown as ProgressFile;
}

function storedDocumentOf(progress: ProgressFile): StoredProgressFileVersionTwo<TaskStatus> {
  return { version: CURRENT_PROGRESS_FILE_VERSION, ...progress };
}

export const ProgressFileMappingUtil = { progressOf, storedDocumentOf } as const;
