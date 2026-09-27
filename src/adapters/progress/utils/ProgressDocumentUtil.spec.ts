/**
 * `status --json` and the page island print this document, so its key order is output: `version` 1 first, the log right after `tasks`
 * even when a setting stored later follows it, and unknown keys where the progress had them.
 */
import { afterAll, expect, test } from 'bun:test';

import type { TrackerProgress }   from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { WordedLogEntry }    from '../../../shared/@types/WordedLogEntry.ts';
import { emptyProgress, fileRow } from '../../../testing/ProgressFixtures.ts';
import { removeScratchDirectory } from '../../../testing/ScratchWorkspace.ts';
import { ProgressDocumentUtil }   from './ProgressDocumentUtil.ts';

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

/** Assembled rather than written as a literal, since a typed literal cannot hold a key the type does not know. */
function progressWithUnknownKeys(): TrackerProgress {
  return Object.assign({ unknownLeadingKey: 'kept' }, emptyProgress(), { unknownMiddleKey: { nested: true }, trailingKey: 'kept' });
}

test('version 1 comes first, whatever the progress holds', () => {
  const document = ProgressDocumentUtil.documentOf(progressWithUnknownKeys(), WORDED_LOG);
  expect(Object.keys(document)[0]).toBe('version');
  expect(document.version).toBe(1);
});

test('the worded log sits directly after tasks, also when a setting stored later follows it', () => {
  const document = ProgressDocumentUtil.documentOf(progressWithSettingsAfterTheLog(), WORDED_LOG);
  const keys     = Object.keys(document);
  expect(keys.slice(keys.indexOf('tasks'))).toEqual(['tasks', 'log', 'dispatcherState', 'dispatcherRunId']);
  expect(document.log).toEqual([...WORDED_LOG]);
});

test('keys the tool does not know keep their place among the others', () => {
  const document = ProgressDocumentUtil.documentOf(progressWithUnknownKeys(), WORDED_LOG);
  expect(Object.keys(document)).toEqual([
    'version',
    'unknownLeadingKey',
    'trackerId',
    'project',
    'startedAt',
    'view',
    'nextTaskId',
    'concurrencyLimit',
    'tasks',
    'log',
    'unknownMiddleKey',
    'trailingKey',
  ]);
});
