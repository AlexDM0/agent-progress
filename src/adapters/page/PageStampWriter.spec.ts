/**
 * The stamp's text is the contract with the template bootstrap, which reads `window.apStamp` as the render's epoch milliseconds and
 * compares it to its own; a second write replaces the file whole.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { createPageStampWriter, pageStampTextOf }         from './PageStampWriter.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

let scratchDirectory: string;

beforeEach(() => {
  scratchDirectory = createScratchDirectory('page-stamp-writer');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

test('the stamp assigns the render\'s epoch milliseconds to window.apStamp', () => {
  expect(pageStampTextOf(GENERATED_AT)).toBe(`window.apStamp = ${GENERATED_AT.getTime()};\n`);
});

test('a later write replaces the stamp whole', () => {
  const stampFilePath = join(scratchDirectory, 'progress.stamp.js');
  const writer = createPageStampWriter(stampFilePath);
  const laterGeneratedAt = new Date(GENERATED_AT.getTime() + 1);

  writer.write(GENERATED_AT);
  writer.write(laterGeneratedAt);

  expect(readFileSync(stampFilePath, 'utf8')).toBe(pageStampTextOf(laterGeneratedAt));
});
