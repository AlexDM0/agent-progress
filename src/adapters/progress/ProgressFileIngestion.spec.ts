/**
 * What the ingestion refuses to believe and what it migrates, read through a real file as every command reads it: absent is never
 * unreadable, every malformed field is named, only versions 1 and 2 are read, a version 1 file's log comes back as notes, retired words
 * and legacy review bars come back current, and a read never writes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import { afterAll, expect, test }      from 'bun:test';

import { ConcurrencyUtil }                                 from '../../lib/tracker-model/utils/ConcurrencyUtil.ts';
import { boardFixture, ticketFixture }                     from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory }  from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion, type ProgressFileReading } from './ProgressFileIngestion.ts';
import { createProgressFileWriter }                        from './ProgressFileWriter.ts';
import {
  documentInRetiredWords,
  emptyDocument,
  emptyProgress,
  fileRow,
  versionOneDocumentOf,
  versionTwoDocumentOf
} from './testing/ProgressFileFixtures.ts';

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
  expect(result.verdict === 'unreadable' ? result.reason : '').toBe('version is 3, and this build of agent-progress reads versions 1 and 2');
});

test('a version 1 file\'s own log comes back as notes, in order with their stamps; a version 2 file has none, its log being log.jsonl', () => {
  const log = [{ at: FILED_AT, text: 'Ticket #001 filed: Example checkout flow' }, { at: STARTED_AT, text: 'Example note' }];
  const versionOne = readBack('store-embedded-log', versionOneDocumentOf(emptyProgress(), log));
  expect(versionOne.verdict === 'readable' ? versionOne.embeddedLog : 'unreadable').toEqual([
    { at: FILED_AT, kind: 'note', fields: { text: 'Ticket #001 filed: Example checkout flow' } },
    { at: STARTED_AT, kind: 'note', fields: { text: 'Example note' } },
  ]);

  const versionTwo = readBack('store-no-embedded-log', emptyDocument());
  expect(versionTwo.verdict === 'readable' ? versionTwo.embeddedLog : 'unreadable').toBeNull();
});

test('the model read from either version holds neither the format\'s version nor a log', () => {
  for (const document of [emptyDocument(), versionOneDocumentOf(emptyProgress())]) {
    const result = readBack('store-model-keys', document);
    if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
    expect(Object.keys(result.progress)).toEqual(Object.keys(emptyProgress()));
  }
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

// Every review row filed before the fields existed has neither; ingestion reads them from its name so that nothing downstream has to.
test('a free-standing row known only by its Review <N> #<id> name reads with the reviewOf and round its name gives, and the read leaves the file as it was', () => {
  const progressFilePath = scratchProgressFilePath('store-review-of');
  const progress         = emptyProgress();
  fileRow(progress, { name: 'Review 1 #3 — x' });
  fileRow(progress, { name: 'Review 2 #3 — x', reviewOf: '003' });
  fileRow(progress, { name: 'Example free row' });
  createProgressFileWriter(progressFilePath).write(progress);
  const bytesBeforeTheRead = readFileSync(progressFilePath);

  const result = new ProgressFileIngestion(progressFilePath).read();
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  const [nameOnlyRow, linkedRow, plainRow] = result.progress.tasks;
  expect(nameOnlyRow).toMatchObject({ reviewOf: '003', reviewBarRound: 1 });
  expect(linkedRow).toMatchObject({ reviewOf: '003', reviewBarRound: 2 });
  expect(plainRow === undefined ? [] : Object.keys(plainRow), 'toEqual would not see a key added as undefined').toEqual(Object.keys(progress.tasks[2] ?? {}));
  expect(readFileSync(progressFilePath)).toEqual(bytesBeforeTheRead);
});

test('a bar that stores its round reads back unchanged', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Review 1 #3 — x', reviewOf: '003', reviewBarRound: 1 });

  const result = readBack('store-review-bar-round', versionTwoDocumentOf(progress));
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  expect(result.progress.tasks[0]?.reviewBarRound).toBe(1);
  expect(result.progress).toEqual(progress);
});

// The page reads a stored reviewOf as a number, so the Board must still find a bar that stored it unpadded.
test('a bar storing an unpadded reviewOf is one of that ticket\'s review bars once read', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example review', reviewOf: '3' });

  const result = readBack('store-unpadded-review-of', progress);
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  const { board } = boardFixture({ tasks: result.progress.tasks, tickets: [ticketFixture({ id: '003' })] });
  expect(board.reviewBarsOf('003').map((task) => task.id)).toEqual([1]);
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
    { prefix: 'store-version-one-without-log', document: { ...progress, version: 1 }, named: 'log is not an array' },
    { prefix: 'store-log-not-array', document: { ...progress, version: 1, log: 'none' }, named: 'log is not an array' },
    { prefix: 'store-version-two-with-log', document: { ...progress, log: [] }, named: 'log is present, and a version 2 file keeps its log in log.jsonl' },
    { prefix: 'store-task-id', document: { ...progress, tasks: [{ ...progress.tasks[0], id: '1' }] }, named: 'tasks[0].id' },
    { prefix: 'store-task-start', document: { ...progress, tasks: [{ ...progress.tasks[0], start: 17 }] }, named: 'tasks[0].start' },
    { prefix: 'store-task-ticket', document: { ...progress, tasks: [{ ...progress.tasks[0], ticket: 3 }] }, named: 'tasks[0].ticket' },
    { prefix: 'store-log-entry', document: { ...progress, version: 1, log: [{ at: FILED_AT }] }, named: 'log[0].text' },
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
      kind: 'absolute', from: FILED_AT, to: FINISHED_AT, tickMinutes: 15 
    } 
  };
  expect(readBack('store-absolute-view', stored).verdict).toBe('readable');
  const relative = {
    ...emptyDocument(),
    view: {
      kind: 'relative', from: '-2h', to: 'now', tickMinutes: null 
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

// A tracker written before the rename must keep working, rows and the phases the page draws alike.
test('a stored running or finished row and history phase reads as in-progress or in-review', () => {
  const result = readBack('store-retired-words', documentInRetiredWords());
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  expect(result.progress.tasks.map((task) => task.status)).toEqual(['in-progress', 'in-review']);
  expect(result.progress.tasks.map((task) => task.history?.map((phase) => phase.status))).toEqual([['pending', 'in-progress'], ['in-progress', 'in-review']]);
});

// `status` and `render` only read, and a read that rewrote the file would race an agent writing it from another worktree.
test('reading a file in the retired words leaves its bytes as they were', () => {
  const progressFilePath = scratchProgressFilePath('store-retired-words-untouched');
  const storedText       = JSON.stringify(documentInRetiredWords(), null, 2);
  writeFileSync(progressFilePath, storedText);
  expect(new ProgressFileIngestion(progressFilePath).read().verdict).toBe('readable');
  expect(readFileSync(progressFilePath, 'utf8')).toBe(storedText);
});

// Only the two retired task words map: a ticket's retired word on a row is as unknown as any other, in the row and in its history.
test('a status that is neither current nor a retired task word still makes the file unreadable, naming the field', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Review pass' });
  const unknownRowStatus = readBack('store-retired-ticket-word', { ...progress, tasks: [{ ...progress.tasks[0], status: 'open' }] });
  expect(unknownRowStatus.verdict).toBe('unreadable');
  expect(unknownRowStatus.verdict === 'unreadable' ? unknownRowStatus.reason : '').toContain('tasks[0].status');

  const unknownPhase = readBack('store-retired-ticket-word-phase', { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'done', at: STARTED_AT }] }] });
  expect(unknownPhase.verdict).toBe('unreadable');
  expect(unknownPhase.verdict === 'unreadable' ? unknownPhase.reason : '').toContain('tasks[0].history');
});
