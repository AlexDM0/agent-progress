/**
 * The catalogue of installed files. The cases that matter: the dispatcher in the git-ignored tracker directory rather than in the project's
 * `.claude/`; the brief in that directory too, where the dispatcher's prompts send every agent, and the install manifest
 * beside what it versions; and every path absolute under the root it was given, since `init` and `update` print them.
 */
import {
  isAbsolute,
  join,
  relative,
  sep
} from 'node:path';

import { expect, test } from 'bun:test';

import { TRACKER_FILES }        from '../src/services/tracker/constants/TrackerFiles.ts';
import { installedFilePathsIn } from './InstalledFiles.ts';

const EXAMPLE_ROOT = join(sep, 'scratch', 'example-repository');

test('the dispatcher script sits in the tracker directory, under the name its meta gives', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).dispatcherScript).toBe(join(EXAMPLE_ROOT, TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'agent-progress-dispatch.js'));
});

test('the briefs sit in the tracker directory, where the dispatcher\'s prompts send every agent to read its own', () => {
  const { agentBrief, builderBrief, reviewBrief } = installedFilePathsIn(EXAMPLE_ROOT);
  for (const briefFilePath of [agentBrief, builderBrief, reviewBrief]) {
    expect(relative(EXAMPLE_ROOT, briefFilePath)).toStartWith(`${TRACKER_FILES.TRACKER_DIRECTORY_NAME}${sep}`);
  }
});

test('the agent definition is named for the type the dispatcher starts its workers as', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).agentDefinition).toBe(join(EXAMPLE_ROOT, '.claude', 'agents', 'agent-progress-worker.md'));
});

test('the install manifest sits in the tracker directory, beside what it versions', () => {
  expect(installedFilePathsIn(EXAMPLE_ROOT).installManifest).toBe(join(EXAMPLE_ROOT, TRACKER_FILES.TRACKER_DIRECTORY_NAME, 'version.json'));
});

test('every path is absolute and under the root it was given', () => {
  const installedFilePaths = Object.values(installedFilePathsIn(EXAMPLE_ROOT));
  expect(installedFilePaths).toHaveLength(7);
  for (const installedFilePath of installedFilePaths) {
    expect(isAbsolute(installedFilePath), installedFilePath).toBe(true);
    expect(installedFilePath).toStartWith(`${EXAMPLE_ROOT}${sep}`);
  }
});
