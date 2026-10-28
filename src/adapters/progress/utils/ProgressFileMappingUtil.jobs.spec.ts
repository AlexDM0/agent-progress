/**
 * The jobs, the job counter and the merge-queue mark in progress.json. What matters: each is written only once set, so a file without them
 * stays byte-identical; a file with them round-trips byte for byte; and a key the tool does not know on a job, its cursor or its slot keeps
 * its place, through a change the Board makes to the job in place.
 */
import { expect, test } from 'bun:test';

import { Board }                      from '../../../lib/tracker-model/Board.ts';
import { createLogger }               from '../../../lib/tracker-model/Logger.ts';
import { JsonTextUtil }               from '../../../shared/utils/JsonTextUtil.ts';
import { emptyProgress, fileRow }     from '../../../testing/ProgressFixtures.ts';
import type { StoredProgressFile }    from '../@types/StoredProgressFile.ts';
import { ProgressFileMappingUtil }    from './ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil } from './ProgressFileValidationUtil.ts';

function storedTextWithJobs(): string {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build', status: 'in-review', ticket: '001' });
  const [row] = progress.tasks;
  const document = {
    version:    2,
    trackerId:  progress.trackerId,
    project:    progress.project,
    startedAt:  progress.startedAt,
    view:       progress.view,
    nextTaskId: progress.nextTaskId,
    nextJobId:  3,
    jobs:       [{
      unknownLeadingJobKey: 'kept',
      id:                   'J2',
      kind:                 'merge',
      role:                 null,
      ticketIds:            ['001'],
      parentJobId:          null,
      attempt:              1,
      target:               'main',
      state:                'merging',
      hostInstance:         1,
      eventCursor:          { instance: 1, unknownCursorKey: 0, sequence: 4 },
      answeredRequestIds:   [],
      crashResumes:         0,
      slot:                 {
        target: 'main', targetTip: 'a1b2c3d', branchTip: 'b2c3d4e', phase: 'merge-in', unknownSlotKey: true,
      },
      unknownTrailingJobKey: { nested: true },
    }],
    tasks: [{ ...row, mergeQueued: true }],
  };
  return JsonTextUtil.storedFileTextOf(document);
}

function storedDocumentOf(text: string): StoredProgressFile {
  const reading = ProgressFileValidationUtil.readingOf(JSON.parse(text));
  if (reading.verdict === 'unreadable') throw new Error(reading.reason);
  return reading.document;
}

test('a file with jobs, the job counter and a merge-queue mark is written back byte for byte', () => {
  const text = storedTextWithJobs();
  expect(JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(storedDocumentOf(text))))).toBe(text);
});

test('a job, its cursor and its slot keep a key the tool does not know where the file had it', () => {
  const [job] = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithJobs())).jobs ?? [];
  expect(Object.keys(job ?? {}).at(0)).toBe('unknownLeadingJobKey');
  expect(Object.keys(job ?? {}).at(-1)).toBe('unknownTrailingJobKey');
  expect(Object.keys(job?.eventCursor ?? {})).toEqual(['instance', 'unknownCursorKey', 'sequence']);
  expect(Object.keys(job?.slot ?? {}).at(-1)).toBe('unknownSlotKey');
});

test('an unknown key on a job survives a move and a launch the Board makes, and the counter moves on', () => {
  const progress = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithJobs()));
  const board    = new Board({
    progress, tickets: [], epics: [], logger: createLogger(() => undefined)
  });
  board.moveJob('J2', 'gating', '2026-09-26T10:15:00+02:00');
  board.launchJob({
    kind: 'build', role: 'builder', ticketIds: [], parentJobId: null, attempt: 1, target: 'main'
  }, '2026-09-26T10:15:00+02:00');

  const stored = ProgressFileMappingUtil.storedDocumentOf(progress);
  expect(stored.nextJobId).toBe(4);
  expect(stored.jobs?.map((job) => job.id)).toEqual(['J2', 'J3']);
  expect(Object.keys(stored.jobs?.[0] ?? {}).at(0)).toBe('unknownLeadingJobKey');
  expect(Reflect.get(stored.jobs?.[0] ?? {}, 'unknownTrailingJobKey')).toEqual({ nested: true });
});

test('a file without jobs, a job counter or a merge-queue mark stores none of them', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const text   = JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(progress));
  const stored = ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(storedDocumentOf(text)));
  expect(JsonTextUtil.storedFileTextOf(stored)).toBe(text);
  expect(Object.hasOwn(stored, 'jobs')).toBe(false);
  expect(Object.hasOwn(stored, 'nextJobId')).toBe(false);
  expect(Object.hasOwn(stored.tasks[0] ?? {}, 'mergeQueued')).toBe(false);
});
