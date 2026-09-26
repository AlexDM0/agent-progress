/**
 * A retired task word passes, in a row and in its history, because the ingestion migrates it after validation; an unknown word still gets
 * the message listing the statuses. Versions 1 and 2 are read: a version 1 file needs its log, a version 2 file must not have one, and any
 * other version is named.
 */
import { expect, test } from 'bun:test';

import {
  documentInRetiredWords,
  emptyDocument,
  emptyProgress,
  fileRow,
  versionOneDocumentOf
} from '../testing/ProgressFileFixtures.ts';
import { ProgressFileValidationUtil } from './ProgressFileValidationUtil.ts';

test('a document holding the retired words running and finished, in rows and in their history, has no problem', () => {
  expect(ProgressFileValidationUtil.documentProblemOf(documentInRetiredWords())).toBeNull();
});

test('a document in the current words has no problem', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build', status: 'in-progress', start: '2026-09-18T20:40:00+02:00' });
  expect(ProgressFileValidationUtil.documentProblemOf(progress)).toBeNull();
});

test('a row status that is neither current nor retired gets the message listing every status', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], status: 'blocked' }] };
  expect(ProgressFileValidationUtil.documentProblemOf(document))
    .toBe('tasks[0].status is "blocked", which is not one of pending, in-progress, paused, in-review, re-review, reviewed, delivered, abandoned');
});

test('a history phase in a retired ticket word is a problem, since only the task words map', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'done', at: '2026-09-18T20:40:00+02:00' }] }] };
  expect(ProgressFileValidationUtil.documentProblemOf(document)).toContain('tasks[0].history');
});

test('a version 1 document with its log has no problem, and one without a log does', () => {
  const withLog = versionOneDocumentOf(emptyProgress(), [{ at: '2026-09-18T20:40:00+02:00', text: 'Example note' }]);
  expect(ProgressFileValidationUtil.documentProblemOf(withLog)).toBeNull();
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), version: 1 })).toBe('log is not an array');
});

test('a version 2 document that holds a log is a problem, because its log is log.jsonl', () => {
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), log: [] })).toBe('log is present, and a version 2 file keeps its log in log.jsonl');
});

test('a document of any version but 1 and 2 is a problem that names the version it has and the ones this build reads', () => {
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), version: 3 })).toBe('version is 3, and this build of agent-progress reads versions 1 and 2');
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), version: '1' })).toBe('version is "1", and this build of agent-progress reads versions 1 and 2');
});
