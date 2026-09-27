/**
 * The validator reads the current format alone: an unknown status word is a problem, in a row and in its history; a version 2 file must not
 * hold a log; and any other version is named. A status or a version an earlier release may have written carries the advice to rewrite it with
 * that release's `update`.
 */
import { expect, test } from 'bun:test';

import { fileRow }                    from '../../../testing/ProgressFixtures.ts';
import { OLDER_FORMAT_ADVICE }        from '../../constants/OlderFormatAdvice.ts';
import { emptyDocument }              from '../testing/ProgressFileFixtures.ts';
import { ProgressFileValidationUtil } from './ProgressFileValidationUtil.ts';

test('a document in the current words has no problem', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build', status: 'in-progress', start: '2026-09-18T20:40:00+02:00' });
  expect(ProgressFileValidationUtil.documentProblemOf(progress)).toBeNull();
});

test('a row status the format does not know gets the message listing every status', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], status: 'blocked' }] };
  expect(ProgressFileValidationUtil.documentProblemOf(document))
    .toBe(`tasks[0].status is "blocked", which is not one of pending, in-progress, paused, in-review, re-review, reviewed, delivered, abandoned; ${OLDER_FORMAT_ADVICE}`);
});

test('a history phase in a status the file format does not know is a problem', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'closed', at: '2026-09-18T20:40:00+02:00' }] }] };
  expect(ProgressFileValidationUtil.documentProblemOf(document)).toStartWith('tasks[0].history');
  expect(ProgressFileValidationUtil.documentProblemOf(document)).toEndWith(OLDER_FORMAT_ADVICE);
});

test('a version 2 document that holds a log is a problem, because its log is log.jsonl', () => {
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), log: [] })).toBe('log is present, and a version 2 file keeps its log in log.jsonl');
});

test('the validator reads only version 2, and names it for any other version, 1 included', () => {
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), version: 1, log: [] }))
    .toBe(`version is 1, and this build of agent-progress reads version 2; ${OLDER_FORMAT_ADVICE}`);
  expect(ProgressFileValidationUtil.documentProblemOf({ ...emptyDocument(), version: 3 }))
    .toBe(`version is 3, and this build of agent-progress reads version 2; ${OLDER_FORMAT_ADVICE}`);
});

test('the header is checked before the rows, and the rows name the first broken one', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example build' });
  const brokenRows = [{ ...progress.tasks[0], owner: 3 }];
  expect(ProgressFileValidationUtil.documentProblemOf({ ...progress, tasks: brokenRows })).toBe('tasks[0].owner is not a string');
  expect(ProgressFileValidationUtil.documentProblemOf({ ...progress, nextTaskId: 0, tasks: brokenRows })).toContain('nextTaskId is 0');
});
