/**
 * A validated progress.json in the current format mapped to the model and back to the stored document. The model does not hold the format's
 * `version`; every other key, unknown ones included, keeps the file's order.
 */
import type { ProgressFile }             from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { StoredProgressFile }       from '../@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

const FORMAT_KEYS: readonly string[] = ['version'];

function progressOf(document: StoredProgressFile): ProgressFile {
  const progressEntries = Object.entries(document).filter(([key]) => !FORMAT_KEYS.includes(key));
  // A walk that keeps key order loses the types; it carries every key of the document but the format's own, which is what the model states.
  return Object.fromEntries(progressEntries) as unknown as ProgressFile;
}

function storedDocumentOf(progress: ProgressFile): StoredProgressFile {
  return { version: CURRENT_PROGRESS_FILE_VERSION, ...progress };
}

export const ProgressFileMappingUtil = { progressOf, storedDocumentOf } as const;
