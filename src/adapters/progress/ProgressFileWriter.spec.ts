/**
 * What the writer puts on disk: a version 2 document with no log that reads back as it was written, indented and newline-terminated for the
 * people who repair it, and `create` never replacing a file that is already there.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import { emptyProgress, fileRow }                         from '../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion }                          from './ProgressFileIngestion.ts';
import { createProgressFileWriter }                       from './ProgressFileWriter.ts';

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
  expect(onDisk.startsWith('{\n  "version": 2,\n')).toBe(true);
  expect(onDisk).not.toContain('"log"');
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
