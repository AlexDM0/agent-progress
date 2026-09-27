/**
 * Builds the older progress documents the legacy specs read: a version 1 file with its own log, and one in the retired task words.
 * Test-only, and it goes when `src/adapters/legacy/` goes.
 */
import type { ProgressFile }                                 from '../../../lib/tracker-model/@types/ProgressFile.ts';
import { emptyProgress, fileRow }                            from '../../../testing/ProgressFixtures.ts';
import type { StoredLogEntry, StoredProgressFileVersionOne } from '../@types/StoredProgressFileVersionOne.ts';

const FILED_AT    = '2026-09-18T20:11:03+02:00';
const STARTED_AT  = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

/** The progress as a build before log.jsonl stored it, with its log after `tasks`, where a file `init` created keeps it. */
export function versionOneDocumentOf(progress: ProgressFile, log: StoredLogEntry[] = []): StoredProgressFileVersionOne {
  return { version: 1, ...progress, log };
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
