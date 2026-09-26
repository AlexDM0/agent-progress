/**
 * The older progress.json shapes read through `ProgressFileIngestion` end to end: a version 1 file's log comes back as notes, a malformed
 * version 1 log is named, retired words and review bars known only by name come back current, and a read never writes.
 * It reads the older input `src/adapters/legacy/` exists for, and is deleted with that folder.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import { afterAll, expect, test }      from 'bun:test';

import { boardFixture, ticketFixture }                     from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory }  from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion, type ProgressFileReading } from '../progress/ProgressFileIngestion.ts';
import { createProgressFileWriter }                        from '../progress/ProgressFileWriter.ts';
import { emptyDocument, emptyProgress, fileRow }           from '../progress/testing/ProgressFileFixtures.ts';
import { documentInRetiredWords, versionOneDocumentOf }    from './testing/LegacyProgressFileFixtures.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';
const STARTED_AT = '2026-09-18T20:40:00+02:00';

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

test('a document from a future format version is refused naming the two versions this build reads', () => {
  const result = readBack('store-future-version', { ...emptyDocument(), version: 3 });
  expect(result.verdict).toBe('unreadable');
  expect(result.verdict === 'unreadable' ? result.reason : '').toBe('version is 3, and this build of agent-progress reads versions 1 and 2');
});

test('a version 1 file\'s own log comes back as notes, in order with their stamps', () => {
  const log = [{ at: FILED_AT, text: 'Ticket #001 filed: Example checkout flow' }, { at: STARTED_AT, text: 'Example note' }];
  const versionOne = readBack('store-embedded-log', versionOneDocumentOf(emptyProgress(), log));
  expect(versionOne.verdict === 'readable' ? versionOne.carriedOverLog : 'unreadable').toEqual([
    { at: FILED_AT, kind: 'note', fields: { text: 'Ticket #001 filed: Example checkout flow' } },
    { at: STARTED_AT, kind: 'note', fields: { text: 'Example note' } },
  ]);
});

test('the model read from a version 1 file holds neither the format\'s version nor a log', () => {
  const result = readBack('store-model-keys', versionOneDocumentOf(emptyProgress()));
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  expect(Object.keys(result.progress)).toEqual(Object.keys(emptyProgress()));
});

test('a version 1 file whose log is missing, not an array or holds a malformed entry is unreadable, naming the log', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Review pass' });
  const cases: Array<{ prefix: string; document: unknown; named: string }> = [
    { prefix: 'store-version-one-without-log', document: { ...progress, version: 1 }, named: 'log is not an array' },
    { prefix: 'store-log-not-array', document: { ...progress, version: 1, log: 'none' }, named: 'log is not an array' },
    { prefix: 'store-log-entry', document: { ...progress, version: 1, log: [{ at: FILED_AT }] }, named: 'log[0].text' },
  ];
  for (const { prefix, document, named } of cases) {
    const result = readBack(prefix, document);
    expect(result.verdict, named).toBe('unreadable');
    expect(result.verdict === 'unreadable' ? result.reason : '', named).toContain(named);
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

// The page reads a stored reviewOf as a number, so the Board must still find a bar that stored it unpadded.
test('a bar storing an unpadded reviewOf is one of that ticket\'s review bars once read', () => {
  const progress = emptyDocument();
  fileRow(progress, { name: 'Example review', reviewOf: '3' });

  const result = readBack('store-unpadded-review-of', progress);
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  const { board } = boardFixture({ tasks: result.progress.tasks, tickets: [ticketFixture({ id: '003' })] });
  expect(board.reviewBarsOf('003').map((task) => task.id)).toEqual([1]);
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
