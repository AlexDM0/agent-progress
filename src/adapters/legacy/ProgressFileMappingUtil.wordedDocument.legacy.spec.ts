/**
 * The document `status --json` and the page island print has the version 1 shape, so it stays a file the ingestion reads, as version 1,
 * owning its log. It reads the older input `src/adapters/legacy/` exists for, and is deleted with that folder.
 */
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import { writeFileAtomically }                            from '../../lib/atomic-file/AtomicFile.ts';
import type { TrackerProgress }                           from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { WordedLogEntry }                            from '../../shared/@types/WordedLogEntry.ts';
import { emptyProgress, fileRow }                         from '../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion }                          from '../progress/ProgressFileIngestion.ts';
import { ProgressFileMappingUtil }                        from '../progress/utils/ProgressFileMappingUtil.ts';

const WORDED_LOG: readonly WordedLogEntry[] = [
  { at: '2026-09-18T20:11:03+02:00', text: 'Ticket #001 filed: Example checkout flow' },
  { at: '2026-09-18T20:40:00+02:00', text: 'Example note from the orchestrator' },
];

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

/** A progress whose settings were set after the log, as a tracker that ran `dispatcher` after `init` stores them. */
function progressWithSettingsAfterTheLog(): TrackerProgress {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  progress.dispatcherState = 'running';
  progress.dispatcherRunId = 'wf_example';
  return progress;
}

test('the document written to a file reads back through the ingestion', () => {
  const directory = createScratchDirectory('progress-document');
  scratchDirectories.push(directory);
  const progressFilePath = join(directory, 'progress.json');
  writeFileAtomically(progressFilePath, JSON.stringify(ProgressFileMappingUtil.wordedDocumentOf(progressWithSettingsAfterTheLog(), WORDED_LOG)));
  const reading = new ProgressFileIngestion(progressFilePath).read();
  expect(reading.verdict).toBe('readable');
  expect(reading.verdict === 'readable' ? reading.carriedOverLog?.map((record) => record.at) : null, 'read as version 1, owning its log')
    .toEqual(WORDED_LOG.map((entry) => entry.at));
});
