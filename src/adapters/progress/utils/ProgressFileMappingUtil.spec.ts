/** Keys the tool does not know are the owner's, so the mapping keeps them, at the top level and on rows, in the order the file had them. */
import { expect, test } from 'bun:test';

import type { TaskStatus }                   from '../../../lib/tracker-model/@types/Task.ts';
import { emptyProgress, fileRow }            from '../../../testing/ProgressFileFixtures.ts';
import type { StoredProgressFileVersionOne } from '../@types/StoredProgressFile.ts';
import { ProgressFileMappingUtil }           from './ProgressFileMappingUtil.ts';

/** Parsed from text, as the ingestion does, since a typed literal cannot hold a key the type does not know. */
function documentWithUnknownKeys(): StoredProgressFileVersionOne<TaskStatus> {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const [row] = progress.tasks;
  const text = JSON.stringify({
    version:       progress.version,
    trackerId:     progress.trackerId,
    unknownTopKey: 'kept',
    project:       progress.project,
    startedAt:     progress.startedAt,
    view:          progress.view,
    nextTaskId:    progress.nextTaskId,
    tasks:         [{ ...row, unknownRowKey: 'kept' }],
    log:           [],
    trailingKey:   { nested: true },
  });
  return JSON.parse(text) as StoredProgressFileVersionOne<TaskStatus>;
}

test('every top-level key, unknown ones included, comes through in the file\'s order', () => {
  const document = documentWithUnknownKeys();
  const progress = ProgressFileMappingUtil.progressOf(document);
  expect(Object.keys(progress)).toEqual(Object.keys(document));
  expect(progress).toEqual(document);
});

test('a row keeps a key the tool does not know', () => {
  const progress = ProgressFileMappingUtil.progressOf(documentWithUnknownKeys());
  expect(Object.keys(progress.tasks[0] ?? {})).toContain('unknownRowKey');
});

test('the mapped progress is a new object, so the document handed in is not the one a command changes', () => {
  const document = documentWithUnknownKeys();
  expect(ProgressFileMappingUtil.progressOf(document)).not.toBe(document);
});
