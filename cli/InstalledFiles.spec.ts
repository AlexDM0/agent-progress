/**
 * The catalogue of installed files. The cases that matter: the session instructions, the reference and the instruction defaults in the
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

test('the session instructions and the reference sit in the tracker directory, the seven instruction defaults in its briefs/defaults', () => {
  const paths = installedFilePathsIn(EXAMPLE_ROOT);
  expect(relative(EXAMPLE_ROOT, paths.sessionInstructions)).toBe(join(TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'session-instructions.md'));
  expect(relative(EXAMPLE_ROOT, paths.reference)).toBe(join(TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'reference.md'));
  const defaults = [
    paths.constitutionDefault,
    paths.builderDefault,
    paths.reviewerDefault,
    paths.mergerDefault,
    paths.productOwnerDefault,
    paths.onboarderDefault,
    paths.assistantDefault,
  ].map((path) => relative(EXAMPLE_ROOT, path));
  expect(defaults).toEqual(['constitution', 'builder', 'reviewer', 'merger', 'productOwner', 'onboarder', 'assistant']
    .map((role) => join(TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'briefs', 'defaults', `${role}.md`)));
});

test('the install manifest sits in the tracker directory, beside what it versions', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).installManifest).toBe(join(EXAMPLE_ROOT, TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'version.json'));
});

test('every path is absolute and under the root it was given', () => {
  const installedFilePaths = Object.values(installedFilePathsIn(EXAMPLE_ROOT));
  expect(installedFilePaths).toHaveLength(10);
  for (const installedFilePath of installedFilePaths) {
    expect(isAbsolute(installedFilePath), installedFilePath).toBe(true);
    expect(installedFilePath).toStartWith(`${EXAMPLE_ROOT}${sep}`);
  }
});
