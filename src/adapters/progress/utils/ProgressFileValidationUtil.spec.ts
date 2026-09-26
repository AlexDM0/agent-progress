/**
 * The one rule the validation changed: a retired task word passes, in a row and in its history, because migration now follows validation.
 * An unknown word still gets the message listing the statuses, and only version 1 is read.
 */
import { expect, test } from 'bun:test';

import { documentInRetiredWords, emptyProgress, fileRow } from '../../../testing/ProgressFileFixtures.ts';
import { ProgressFileValidationUtil }                     from './ProgressFileValidationUtil.ts';

test('a document holding the retired words running and finished, in rows and in their history, has no problem', () => {
  expect(ProgressFileValidationUtil.documentProblemOf(documentInRetiredWords())).toBeNull();
});

test('a document in the current words has no problem', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build', status: 'in-progress', start: '2026-09-18T20:40:00+02:00' });
  expect(ProgressFileValidationUtil.documentProblemOf(progress)).toBeNull();
});

test('a row status that is neither current nor retired gets the message listing every status', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], status: 'blocked' }] };
  expect(ProgressFileValidationUtil.documentProblemOf(document))
    .toBe('tasks[0].status is "blocked", which is not one of pending, in-progress, paused, in-review, re-review, reviewed, delivered, abandoned');
});

test('a history phase in a retired ticket word is a problem, since only the task words map', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'done', at: '2026-09-18T20:40:00+02:00' }] }] };
  expect(ProgressFileValidationUtil.documentProblemOf(document)).toContain('tasks[0].history');
});

test('a document of any version but 1 is a problem that names the version it has and the one this build reads', () => {
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyProgress(), version: 2 })).toBe('version is 2, and this build of agent-progress reads version 1');
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyProgress(), version: '1' })).toBe('version is "1", and this build of agent-progress reads version 1');
});
