/**
 * The catalogue of installed files. The cases that matter: the session instructions, the reference and the Assistant brief in the
 * git-ignored tracker directory, where the SessionStart hook, the skills and the Overseer read them, and the install manifest beside what
 * it versions; and every path absolute under the root it was given, since `init` and `update` print them.
 */
import {
  isAbsolute,
  join,
  relative,
  sep
} from 'node:path';

import { expect, test }  from 'bun:test';
import { TRACKER_FILES } from '../src/services/tracker/constants/TrackerFiles.ts';

import { installedFilePathsIn } from './InstalledFiles.ts';

const EXAMPLE_ROOT = join(sep, 'scratch', 'example-repository');

test('the session instructions, the reference and the Assistant brief sit in the tracker directory', () => {
  const { sessionInstructions, reference, assistantBrief } = installedFilePathsIn(EXAMPLE_ROOT);
  expect(relative(EXAMPLE_ROOT, sessionInstructions)).toBe(join(TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'session-instructions.md'));
  expect(relative(EXAMPLE_ROOT, reference)).toBe(join(TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'reference.md'));
  expect(relative(EXAMPLE_ROOT, assistantBrief)).toBe(join(TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'assistant-brief.md'));
});

test('the install manifest sits in the tracker directory, beside what it versions', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).installManifest).toBe(join(EXAMPLE_ROOT, TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'version.json'));
});

test('every path is absolute and under the root it was given', () => {
  const installedFilePaths = Object.values(installedFilePathsIn(EXAMPLE_ROOT));
  expect(installedFilePaths).toHaveLength(4);
  for (const installedFilePath of installedFilePaths) {
    expect(isAbsolute(installedFilePath), installedFilePath).toBe(true);
    expect(installedFilePath).toStartWith(`${EXAMPLE_ROOT}${sep}`);
  }
});
