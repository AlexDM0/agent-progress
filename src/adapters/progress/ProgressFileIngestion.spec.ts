/**
 * What the ingestion refuses to believe, read through a real file as every command reads it: absent is never unreadable, every malformed
 * field is named, a future version is refused, and a version 2 file carries no log over.
 */
import { writeFileSync }          from 'node:fs';
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import { ConcurrencyUtil }                                 from '../../lib/tracker-model/utils/ConcurrencyUtil.ts';
import { emptyProgress, fileRow }                          from '../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory }  from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion, type ProgressFileReading } from './ProgressFileIngestion.ts';
import { emptyDocument, versionTwoDocumentOf }             from './testing/ProgressFileFixtures.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';
const STARTED_AT = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchProgressFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'progress.json');
}

function readBack(prefix: string, document: unknown): ProgressFileReading {
  const progressFilePath = scratchProgressFilePath(prefix);
  writeFileSync(progressFilePath, typeof document === 'string' ? document : JSON.stringify(document));
  return new ProgressFileIngestion(progressFilePath).read();
}

test('a tracker that has never been initialised is absent, not unreadable', () => {
  expect(new ProgressFileIngestion(scratchProgressFilePath('store-absent')).read().verdict).toBe('absent');
});

test('a file that is not JSON is unreadable and says so', () => {
  const result = readBack('store-not-json', '{ this is not json');
  expect(result.verdict).toBe('unreadable');
  expect(result.verdict === 'unreadable' ? result.reason : '').toContain('not valid JSON');
});

test('a document from a future format version is refused rather than half-read', () => {
  const result = readBack('store-future-version', { ...emptyDocument(), version: 3 });
  expect(result.verdict).toBe('unreadable');
  expect(result.verdict === 'unreadable' ? result.reason : '').toStartWith('version is 3, ');
});

test('the model read from a version 2 file holds neither the format\'s version nor a log', () => {
  const result = readBack('store-model-keys', emptyDocument());
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  expect(Object.keys(result.progress)).toEqual(Object.keys(emptyProgress()));
});

// Every tracker filed before the limit existed has no such field, and must go on reading rather than stop every command in its repository.
test('a document with no concurrency limit reads, and its figures fall back to the default of 2', () => {
  const withoutLimit = emptyDocument();
  delete withoutLimit.concurrencyLimit;
  const result = readBack('store-no-limit', withoutLimit);
  expect(result.verdict).toBe('readable');
  const concurrency = result.verdict === 'readable' ? ConcurrencyUtil.concurrencyOf(result.progress.tasks, result.progress.concurrencyLimit) : null;
  expect(concurrency).toEqual({ limit: 2, agentsInFlight: 0, freeSlots: 2 });
});

test('a concurrency limit that is not a whole number of at least 1 makes the file unreadable, and the reason names the field', () => {
  for (const malformedLimit of [0, -1, 2.5, '3', null]) {
    const result = readBack('store-malformed-limit', { ...emptyDocument(), concurrencyLimit: malformedLimit });
    expect(result.verdict === 'unreadable' ? result.reason : '', JSON.stringify(malformedLimit)).toContain('concurrencyLimit');
  }
});

test('a bar that stores its round reads back unchanged', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Review 1 #3 — x', reviewOf: '003', reviewBarRound: 1 });

  const result = readBack('store-review-bar-round', versionTwoDocumentOf(progress));
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  expect(result.progress.tasks[0]?.reviewBarRound).toBe(1);
  expect(result.progress).toEqual(progress);
});

test('a task whose status this build does not know makes the whole file unreadable, and the reason names the task and the status', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], status: 'blocked' }] };
  const result = readBack('store-unknown-status', document);
  expect(result.verdict).toBe('unreadable');
  const reason = result.verdict === 'unreadable' ? result.reason : '';
  expect(reason).toContain('tasks[0].status');
  expect(reason).toContain('blocked');
  expect(reason, 'the reason lists what a status may be').toContain('delivered');
});

test('every other missing or mistyped field is named too', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Review pass' });
  const cases: Array<{ prefix: string; document: unknown; named: string }> = [
    { prefix: 'store-not-an-object', document: [1, 2, 3], named: 'JSON object' },
    { prefix: 'store-no-tracker-id', document: { ...progress, trackerId: 17 }, named: 'trackerId' },
    { prefix: 'store-no-project', document: { ...progress, project: null }, named: 'project' },
    { prefix: 'store-no-started-at', document: { ...progress, startedAt: undefined }, named: 'startedAt' },
    { prefix: 'store-bad-view', document: { ...progress, view: { kind: 'sliding' } }, named: 'view' },
    { prefix: 'store-tasks-not-array', document: { ...progress, tasks: {} }, named: 'tasks' },
    { prefix: 'store-version-two-with-log', document: { ...progress, log: [] }, named: 'log is present, and a version 2 file keeps its log in log.jsonl' },
    { prefix: 'store-task-id', document: { ...progress, tasks: [{ ...progress.tasks[0], id: '1' }] }, named: 'tasks[0].id' },
    { prefix: 'store-task-start', document: { ...progress, tasks: [{ ...progress.tasks[0], start: 17 }] }, named: 'tasks[0].start' },
    { prefix: 'store-task-ticket', document: { ...progress, tasks: [{ ...progress.tasks[0], ticket: 3 }] }, named: 'tasks[0].ticket' },
    { prefix: 'store-no-next-id', document: { ...progress, nextTaskId: undefined }, named: 'nextTaskId' },
    { prefix: 'store-zero-next-id', document: { ...progress, nextTaskId: 0 }, named: 'nextTaskId' },
    { prefix: 'store-task-tokens', document: { ...progress, tasks: [{ ...progress.tasks[0], tokens: -1 }] }, named: 'tasks[0].tokens' },
    { prefix: 'store-task-reviewed', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewed: true }] }, named: 'tasks[0].reviewed' },
    { prefix: 'store-fractional-tokens', document: { ...progress, tasks: [{ ...progress.tasks[0], tokens: 1.5 }] }, named: 'tasks[0].tokens' },
    { prefix: 'store-first-review-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 1 }] }, named: 'tasks[0].reviewRound' },
    { prefix: 'store-fractional-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 2.5 }] }, named: 'tasks[0].reviewRound' },
    { prefix: 'store-written-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 'second' }] }, named: 'tasks[0].reviewRound' },
    { prefix: 'store-history-not-array', document: { ...progress, tasks: [{ ...progress.tasks[0], history: 'in-progress' }] }, named: 'tasks[0].history' },
    {
      prefix:   'store-history-unknown-status',
      document: { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'blocked', at: FILED_AT }] }] },
      named:    'tasks[0].history',
    },
    { prefix: 'store-history-no-stamp', document: { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'in-progress' }] }] }, named: 'tasks[0].history' },
    {
      prefix:   'store-agent-not-text',
      document: { ...progress, tasks: [{ ...progress.tasks[0], agent: 3 }] },
      named:    'tasks[0].agent',
    },
    {
      prefix:   'store-review-of-not-text',
      document: { ...progress, tasks: [{ ...progress.tasks[0], reviewOf: 3 }] },
      named:    'tasks[0].reviewOf',
    },
    { prefix: 'store-zero-bar-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewBarRound: 0 }] }, named: 'tasks[0].reviewBarRound' },
    { prefix: 'store-fractional-bar-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewBarRound: 1.5 }] }, named: 'tasks[0].reviewBarRound' },
    { prefix: 'store-written-bar-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewBarRound: '2' }] }, named: 'tasks[0].reviewBarRound' },
  ];
  for (const { prefix, document, named } of cases) {
    const result = readBack(prefix, document);
    expect(result.verdict, named).toBe('unreadable');
    expect(result.verdict === 'unreadable' ? result.reason : '', named).toContain(named);
  }
});

test('an absolute view range with its fields intact is accepted, because that is a range someone stored on purpose', () => {
  const stored = {
    ...emptyDocument(),
    view: {
      kind:        'absolute',
      from:        FILED_AT,
      to:          FINISHED_AT,
      tickMinutes: 15,
    }
  };
  expect(readBack('store-absolute-view', stored).verdict).toBe('readable');
  const relative = {
    ...emptyDocument(),
    view: {
      kind:        'relative',
      from:        '-2h',
      to:          'now',
      tickMinutes: null,
    }
  };
  expect(readBack('store-relative-view', relative).verdict).toBe('readable');
});

test('a round of two or more is read back, because that is a row someone deliberately sent round again', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 3 }] };
  expect(readBack('store-third-round', document).verdict).toBe('readable');
});

test('a history of known statuses with their stamps is read back', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'in-progress', at: STARTED_AT }] }] };
  expect(readBack('store-history-readable', document).verdict).toBe('readable');
});
