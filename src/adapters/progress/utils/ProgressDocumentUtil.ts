import type { TrackerProgress }               from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { ProgressDocument }              from '../../../shared/@types/ProgressDocument.ts';
import type { WordedLogEntry }                from '../../../shared/@types/WordedLogEntry.ts';
import { EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

/**
 * The progress in the version 1 shape, which the ingestion reads back: `version` first, every other key in the progress's order, and the
 * worded log directly after `tasks`.
 */
function documentOf<Entry extends WordedLogEntry>(progress: TrackerProgress, log: readonly Entry[]): ProgressDocument<Entry> {
  const entries: [string, unknown][] = [['version', EMBEDDED_LOG_PROGRESS_FILE_VERSION]];
  for (const [key, value] of Object.entries(progress)) {
    entries.push([key, value]);
    if (key === 'tasks') entries.push(['log', [...log]]);
  }
  // A walk that keeps key order loses the types; it carries every key of the progress plus `version` and `log`, which is what the type states.
  return Object.fromEntries(entries) as unknown as ProgressDocument<Entry>;
}

export const ProgressDocumentUtil = { documentOf } as const;
