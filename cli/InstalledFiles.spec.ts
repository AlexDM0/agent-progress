/**
 * The catalogue of installed files. The cases that matter: the managed CLAUDE.md markers, since the block writer finds the end by searching
 * forward from the start and the block sits in a file people read rendered; the dispatcher in the git-ignored tracker directory rather than
 * in the project's `.claude/`; and every path absolute under the root it was given, since `init` and `update` print them.
 */
import { isAbsolute, join, sep } from 'node:path';

import { expect, test } from 'bun:test';

import { TRACKER_FILES }                                      from '../src/services/tracker/constants/TrackerFiles';
import { CLAUDE_MANAGED_BLOCK_MARKERS, installedFilePathsIn } from './InstalledFiles';

const { start, end } = CLAUDE_MANAGED_BLOCK_MARKERS;

const EXAMPLE_ROOT = join(sep, 'scratch', 'example-repository');

test('neither managed marker contains the other, so the search for the end marker cannot match the start marker', () => {
  expect(start).not.toBe(end);
  expect(start).not.toContain(end);
  expect(end).not.toContain(start);
});

test('both markers are HTML comments on a single line, so they stay invisible in a rendered CLAUDE.md', () => {
  for (const marker of [start, end]) {
    expect(marker.startsWith('<!--'), marker).toBe(true);
    expect(marker.endsWith('-->'), marker).toBe(true);
    expect(marker).not.toContain('\n');
  }
});

test('the dispatcher script sits in the tracker directory, under the name its meta gives', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).dispatcherScript).toBe(join(EXAMPLE_ROOT, TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'agent-progress-dispatch.js'));
});

test('the retired dispatcher path is the copy an older agent-progress installed under .claude/workflows', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).retiredDispatcherScript).toBe(join(EXAMPLE_ROOT, '.claude', 'workflows', 'agent-progress-dispatch.js'));
});

test('every path is absolute and under the root it was given', () => {
  const installedFilePaths = Object.values(installedFilePathsIn(EXAMPLE_ROOT));
  expect(installedFilePaths).toHaveLength(5);
  for (const installedFilePath of installedFilePaths) {
    expect(isAbsolute(installedFilePath), installedFilePath).toBe(true);
    expect(installedFilePath).toStartWith(`${EXAMPLE_ROOT}${sep}`);
  }
});
