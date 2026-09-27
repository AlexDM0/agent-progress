import type { TrackerProgress }               from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { ProgressDocument }              from '../../../shared/@types/ProgressDocument.ts';
import type { WordedLogEntry }                from '../../../shared/@types/WordedLogEntry.ts';
import { EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

/**
 * The progress in the version 1 shape, which the ingestion reads back: `version` first, every other key in the progress's order, and the
 * worded log directly after `tasks`.
 */
function documentOf<Entry extends WordedLogEntry>(progress: TrackerProgress, log: readonly Entry[]): ProgressDocument<Entry> {
  const keyOrder                             = ['version', ...Object.keys(progress).flatMap((key) => (key === 'tasks' ? [key, 'log'] : [key]))];
  const keyedInOrder: Record<string, unknown> = Object.fromEntries(keyOrder.map((key) => [key, undefined]));
  return Object.assign(keyedInOrder, progress, { version: EMBEDDED_LOG_PROGRESS_FILE_VERSION, log: [...log] });
}

export const ProgressDocumentUtil = { documentOf } as const;
