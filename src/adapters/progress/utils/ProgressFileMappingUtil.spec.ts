/**
 * The model holds neither the format's `version` nor its log, so the mapping strips both from either version and puts `version` 2 back
 * first on the way out. Keys the tool does not know are the owner's, so they survive both ways, at the top level and on rows, in the file's order.
 */
import { expect, test } from 'bun:test';

import type { TaskStatus }         from '../../../lib/tracker-model/@types/Task.ts';
import type { StoredProgressFile } from '../@types/StoredProgressFile.ts';
import { emptyProgress, fileRow }  from '../testing/ProgressFileFixtures.ts';
import { ProgressFileMappingUtil } from './ProgressFileMappingUtil.ts';

/** Parsed from text, as the ingestion does, since a typed literal cannot hold a key the type does not know. */
function documentWithUnknownKeys(version: 1 | 2): StoredProgressFile<TaskStatus> {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const [row] = progress.tasks;
  const text = JSON.stringify({
    version,
    trackerId:     progress.trackerId,
    unknownTopKey: 'kept',
    project:       progress.project,
    startedAt:     progress.startedAt,
    view:          progress.view,
    nextTaskId:    progress.nextTaskId,
    tasks:         [{ ...row, unknownRowKey: 'kept' }],
    ...(version === 1 ? { log: [{ at: progress.startedAt, text: 'Example note' }] } : {}),
    trailingKey:   { nested: true },
  });
  return JSON.parse(text) as StoredProgressFile<TaskStatus>;
}

test('every top-level key but version and log, unknown ones included, comes through in the file\'s order, from either version', () => {
  for (const version of [1, 2] as const) {
    const progress = ProgressFileMappingUtil.progressOf(documentWithUnknownKeys(version));
    expect(Object.keys(progress), `version ${version}`).toEqual(['trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
  }
});

test('a row keeps a key the tool does not know', () => {
  const progress = ProgressFileMappingUtil.progressOf(documentWithUnknownKeys(2));
  expect(Object.keys(progress.tasks[0] ?? {})).toContain('unknownRowKey');
});

test('the mapped progress is a new object, so the document handed in is not the one a command changes', () => {
  const document = documentWithUnknownKeys(2);
  expect(ProgressFileMappingUtil.progressOf(document)).not.toBe(document);
});

test('the stored document puts version 2 first, holds no log, and keeps every other key where the progress had it', () => {
  const versionOne = documentWithUnknownKeys(1);
  const stored     = ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(versionOne));
  expect(Object.keys(stored)).toEqual(['version', 'trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
  expect(stored.version).toBe(2);
  expect(JSON.stringify(stored), 'the file a version 2 build would have written').toBe(JSON.stringify(documentWithUnknownKeys(2)));
});
