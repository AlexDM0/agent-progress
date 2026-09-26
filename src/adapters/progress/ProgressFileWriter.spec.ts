/**
 * What the writer puts on disk: a document that reads back as it was written, indented and newline-terminated for the people who repair it,
 * the fields a read gave a legacy row stored, the current status words stored, and `create` never replacing a file that is already there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import { afterAll, expect, test }      from 'bun:test';

import type { ProgressFile }                              from '../../lib/tracker-model/@types/ProgressFile.ts';
import { emptyProgress, fileRow, documentInRetiredWords } from '../../testing/ProgressFileFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion }                          from './ProgressFileIngestion.ts';
import { createProgressFileWriter }                       from './ProgressFileWriter.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchProgressFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'progress.json');
}

test('a written tracker reads back exactly as it was written', () => {
  const progressFilePath = scratchProgressFilePath('store-round-trip');
  const progress         = emptyProgress();
  fileRow(progress, { name: 'Review pass', owner: 'Alex Example', note: 'second reading' });
  progress.log.push({ at: FILED_AT, text: 'Session started' });
  createProgressFileWriter(progressFilePath).write(progress);

  const result = new ProgressFileIngestion(progressFilePath).read();
  expect(result.verdict).toBe('readable');
  expect(result.verdict === 'readable' ? result.progress : null).toEqual(progress);
});

test('the file on disk is indented and ends with a newline, because people repair it by hand', () => {
  const progressFilePath = scratchProgressFilePath('store-formatting');
  createProgressFileWriter(progressFilePath).write(emptyProgress());
  const onDisk = readFileSync(progressFilePath, 'utf8');
  expect(onDisk.endsWith('\n')).toBe(true);
  expect(onDisk).toContain('\n  "version": 1');
});

test('a write after the read stores the reviewOf and round a legacy name gave', () => {
  const progressFilePath = scratchProgressFilePath('store-review-of');
  const progress         = emptyProgress();
  fileRow(progress, { name: 'Review 1 #3 — x' });
  createProgressFileWriter(progressFilePath).write(progress);

  const result = new ProgressFileIngestion(progressFilePath).read();
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  createProgressFileWriter(progressFilePath).write(result.progress);

  const onDisk = JSON.parse(readFileSync(progressFilePath, 'utf8')) as ProgressFile;
  expect(onDisk.tasks[0]).toMatchObject({ reviewOf: '003', reviewBarRound: 1 });
});

test('the next write of a file read in the retired words stores the new ones', () => {
  const progressFilePath = scratchProgressFilePath('store-retired-words');
  writeFileSync(progressFilePath, JSON.stringify(documentInRetiredWords()));
  const result = new ProgressFileIngestion(progressFilePath).read();
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  createProgressFileWriter(progressFilePath).write(result.progress);
  const rewrittenText = readFileSync(progressFilePath, 'utf8');
  expect(rewrittenText).toContain('"in-progress"');
  expect(rewrittenText).toContain('"in-review"');
  expect(rewrittenText).not.toContain('"running"');
  expect(rewrittenText).not.toContain('"finished"');
});

// `init` must never replace a tracker, whatever path led it to one.
test('create writes a file that is not there, and refuses one that is, leaving it as it was', () => {
  const progressFilePath = scratchProgressFilePath('store-create');
  const writer           = createProgressFileWriter(progressFilePath);
  expect(writer.create(emptyProgress())).toBe('created');
  const bytesAfterTheCreation = readFileSync(progressFilePath);

  const anotherTracker = { ...emptyProgress(), project: 'Another Example Agency' };
  expect(writer.create(anotherTracker)).toBe('already-exists');
  expect(readFileSync(progressFilePath)).toEqual(bytesAfterTheCreation);
});
