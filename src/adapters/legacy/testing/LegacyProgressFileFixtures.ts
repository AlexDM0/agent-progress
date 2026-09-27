/**
 * Builds, or writes to disk, the older progress documents the legacy specs read: a version 1 file with its own log, and one in the retired task words.
 * Test-only, and it goes when `src/adapters/legacy/` goes.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import type { TrackerProgress }                              from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import { LIMITS }                                            from '../../../shared/constants/Limits.ts';
import { emptyProgress, fileRow }                            from '../../../testing/ProgressFixtures.ts';
import { createProgressFileWriter }                          from '../../progress/ProgressFileWriter.ts';
import type { StoredLogEntry, StoredProgressFileVersionOne } from '../@types/StoredProgressFileVersionOne.ts';

const FILED_AT    = '2026-09-18T20:11:03+02:00';
const STARTED_AT  = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

/** The progress as a build before log.jsonl stored it, with its log after `tasks`, where a file `init` created keeps it. */
export function versionOneDocumentOf(progress: TrackerProgress, log: StoredLogEntry[] = []): StoredProgressFileVersionOne {
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

/** An empty tracker's progress file stored as version 1 with this log; the writer only writes version 2, so the version is set by hand. */
export function writeVersionOneProgressFile(progressFilePath: string, log: StoredLogEntry[]): void {
  createProgressFileWriter(progressFilePath).write(emptyProgress());
  const stored = JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>;
  writeFileSync(progressFilePath, `${JSON.stringify({ ...stored, version: 1, log }, null, LIMITS.JSON_INDENT_SPACES)}\n`);
}
