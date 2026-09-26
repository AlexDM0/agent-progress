/**
 * The model does not hold the format's `version`, so the mapping strips it and puts `version` 2 back first on the way out. Keys the tool
 * does not know are the owner's, so they survive both ways, at the top level and on rows, in the file's order.
 */
import { expect, test } from 'bun:test';

import type { StoredProgressFile } from '../@types/StoredProgressFile.ts';
import { emptyProgress, fileRow }  from '../testing/ProgressFileFixtures.ts';
import { ProgressFileMappingUtil } from './ProgressFileMappingUtil.ts';

/** Parsed from text, as the ingestion does, since a typed literal cannot hold a key the type does not know. */
function documentWithUnknownKeys(): StoredProgressFile {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const [row] = progress.tasks;
  const text = JSON.stringify({
    version:       2,
    trackerId:     progress.trackerId,
    unknownTopKey: 'kept',
    project:       progress.project,
    startedAt:     progress.startedAt,
    view:          progress.view,
    nextTaskId:    progress.nextTaskId,
    tasks:         [{ ...row, unknownRowKey: 'kept' }],
    trailingKey:   { nested: true },
  });
  return JSON.parse(text) as StoredProgressFile;
}

test('every top-level key but version, unknown ones included, comes through in the file\'s order', () => {
  const progress = ProgressFileMappingUtil.progressOf(documentWithUnknownKeys());
  expect(Object.keys(progress), 'version 2').toEqual(['trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
});

test('a row keeps a key the tool does not know', () => {
  const progress = ProgressFileMappingUtil.progressOf(documentWithUnknownKeys());
  expect(Object.keys(progress.tasks[0] ?? {})).toContain('unknownRowKey');
});

test('the mapped progress is a new object, so the document handed in is not the one a command changes', () => {
  const document = documentWithUnknownKeys();
  expect(ProgressFileMappingUtil.progressOf(document)).not.toBe(document);
});

test('the stored document puts version 2 first and keeps every other key where the progress had it', () => {
  const stored = ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(documentWithUnknownKeys()));
  expect(Object.keys(stored)).toEqual(['version', 'trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
  expect(JSON.stringify(stored), 'the file as it was read').toBe(JSON.stringify(documentWithUnknownKeys()));
});
