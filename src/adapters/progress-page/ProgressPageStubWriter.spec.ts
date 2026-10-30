/**
 * The `progress.html` stub the monitor registry names: it says where the live Overseer is, its URL escaped, or that none serves the board
 * and which command starts one; a rewrite replaces the file atomically.
 */
import { readFileSync, statSync } from 'node:fs';
import { join }                   from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';

import { PRODUCT_NAMES }                                        from '../../shared/constants/ProductNames.ts';
import { createScratchDirectory, removeScratchDirectory }       from '../../testing/ScratchWorkspace.ts';
import { createProgressPageStubWriter, progressPageStubTextOf } from './ProgressPageStubWriter.ts';

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('progress-page-stub');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

test('a live Overseer is named by its URL, escaped once', () => {
  const text = progressPageStubTextOf('http://127.0.0.1:4930/?a=1&b=2');
  expect(text).toContain('Live at <a href="http://127.0.0.1:4930/?a=1&amp;b=2">http://127.0.0.1:4930/?a=1&amp;b=2</a>.');
  expect(text).not.toContain('Overseer down');
});

test('with no live Overseer the stub says it is down and names the command that starts one', () => {
  expect(progressPageStubTextOf(null)).toContain(`Overseer down. Start one with <code>${PRODUCT_NAMES.PROGRAM} oversee --detach</code>.`);
});

test('the writer replaces the file whole, live then down', () => {
  const htmlFilePath = join(scratchDirectory, 'progress.html');
  const writer       = createProgressPageStubWriter(htmlFilePath);
  writer.write('http://127.0.0.1:4930/');
  const firstInode = statSync(htmlFilePath).ino;
  writer.write(null);
  expect(readFileSync(htmlFilePath, 'utf8')).toBe(progressPageStubTextOf(null));
  expect(statSync(htmlFilePath).ino).not.toBe(firstInode);
});
