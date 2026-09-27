/**
 * The three answers of a stored file's read. The case that matters is a path that exists but cannot be read, here a directory, which must be
 * unreadable and never absent, because an absent file invites its caller to treat a good one as missing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import { afterAll, expect, test } from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../testing/ScratchWorkspace.ts';
import { storedFileTextOf }                               from './StoredFileText.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'stored.json');
}

test('a file that is there reads as its text', () => {
  const filePath = scratchFilePath('stored-file-readable');
  writeFileSync(filePath, '{ "project": "Example Agency" }\n');
  expect(storedFileTextOf(filePath)).toEqual({ verdict: 'readable', text: '{ "project": "Example Agency" }\n' });
});

test('a file that is not there reads as absent', () => {
  expect(storedFileTextOf(scratchFilePath('stored-file-absent'))).toEqual({ verdict: 'absent' });
});

test('a path that exists but cannot be read is unreadable, the reason naming the error', () => {
  const filePath = scratchFilePath('stored-file-directory');
  mkdirSync(filePath);
  const storedText = storedFileTextOf(filePath);
  expect(storedText.verdict).toBe('unreadable');
  expect(storedText.verdict === 'unreadable' ? storedText.reason : '').toStartWith('it could not be read (');
});
