import type { ProgressFile }                  from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { ProgressDocument }              from '../../../shared/@types/ProgressDocument.ts';
import type { WordedLogEntry }                from '../../../shared/@types/WordedLogEntry.ts';
import { EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

/**
 * The progress in the version 1 shape, which the ingestion reads back: `version` first, every other key in the progress's order, and the
 * worded log directly after `tasks`.
 */
function documentOf(progress: ProgressFile, log: readonly WordedLogEntry[]): ProgressDocument {
  const entries: [string, unknown][] = [['version', EMBEDDED_LOG_PROGRESS_FILE_VERSION]];
  for (const [key, value] of Object.entries(progress)) {
    entries.push([key, value]);
    if (key === 'tasks') entries.push(['log', [...log]]);
  }
  // A walk that keeps key order loses the types; it carries every key of the progress plus `version` and `log`, which is what the type states.
  return Object.fromEntries(entries) as unknown as ProgressDocument;
}

export const ProgressDocumentUtil = { documentOf } as const;
