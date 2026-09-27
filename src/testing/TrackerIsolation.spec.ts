/**
 * The guard between the suite and a tracker it did not create. Each way out of the scratch root is constructed here rather than found, because the
 * repository under test may or may not hold a real tracker: a directory outside the root, a walk up that reaches a tracker above the root, and an
 * `AGENT_PROGRESS_ROOT` naming one — the last in a child process, since only `src/shared/Environment.spec.ts` assigns the environment in-process.
 * The two helpers every spec drives a command through are pinned in their own specs under `cli/testing/`.
 */
import { mkdirSync } from 'node:fs';
import { join }      from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
}                    from 'bun:test';

import { jsonPrintedByAChildProcess }                                                      from './ChildProcessEvaluation.ts';
import { createCanonicalScratchDirectory, createScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';
import { writeMinimalTracker }                                                             from './TrackerFileFixtures.ts';
import { requireTrackerIsolation, trackerIsolationVerdictFor }                             from './TrackerIsolation.ts';

const TRACKER_ISOLATION_MODULE_PATH = join(import.meta.dir, 'TrackerIsolation.ts');
const REPOSITORY_DIRECTORY          = join(import.meta.dir, '..', '..');
const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchDirectory(prefix: string): string {
  const directory = createCanonicalScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

/** A tracker at the top of a scratch directory, and a narrower scratch root below it, so the tracker is outside the root the guard is given. */
function trackerAboveANarrowerScratchRoot(): { narrowerScratchRoot: string; startDirectory: string } {
  const outerDirectory = writeMinimalTracker(scratchDirectory('isolation-outer'));
  const narrowerScratchRoot = join(outerDirectory, 'narrower-scratch-root');
  const startDirectory = join(narrowerScratchRoot, 'spec-working-directory');
  mkdirSync(startDirectory, { recursive: true });
  return { narrowerScratchRoot, startDirectory };
}

function verdictFromAChildProcess(childEnvironment: Record<string, string>, startDirectory: string): string {
  const source = [
    `const loaded = await import(${JSON.stringify(TRACKER_ISOLATION_MODULE_PATH)});`,
    `console.log(JSON.stringify(loaded.trackerIsolationVerdictFor(${JSON.stringify(startDirectory)})));`,
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source) as string;
}

describe('the verdict on one directory', () => {
  test('a scratch directory holding its own tracker is isolated', () => {
    const trackedScratchDirectory = writeMinimalTracker(scratchDirectory('isolation-own'));
    expect(trackerIsolationVerdictFor(trackedScratchDirectory)).toBe('isolated');
    expect(trackerIsolationVerdictFor(join(trackedScratchDirectory, 'not-created-yet'))).toBe('isolated');
  });

  // A scratch directory is handed out uncanonical (`/var` rather than `/private/var` on macOS), and a spec may name a folder below it before making it.
  test('a directory not created yet below a scratch directory as it was handed out is isolated', () => {
    const uncanonicalScratchDirectory = createScratchDirectory('isolation-uncanonical');
    scratchDirectories.push(uncanonicalScratchDirectory);
    expect(trackerIsolationVerdictFor(join(uncanonicalScratchDirectory, 'not-created-yet', 'nested'))).toBe('isolated');
  });

  // A context defaulting to the test runner's directory would be the repository itself, holding a live tracker.
  test('the repository under test is outside the scratch root, whether or not it holds a tracker', () => {
    expect(trackerIsolationVerdictFor(REPOSITORY_DIRECTORY)).toBe('directory-outside-the-scratch-root');
  });

  test('the scratch root itself is not a directory inside it', () => {
    const narrowerScratchRoot = scratchDirectory('isolation-root');
    expect(trackerIsolationVerdictFor(narrowerScratchRoot, narrowerScratchRoot)).toBe('directory-outside-the-scratch-root');
  });

  // A worktree's working directory is inside its own folder while discovery resolves the main checkout's tracker, so the directory alone proves nothing.
  test('a directory inside the root whose walk up reaches a tracker outside it is refused', () => {
    const { narrowerScratchRoot, startDirectory } = trackerAboveANarrowerScratchRoot();
    expect(trackerIsolationVerdictFor(startDirectory, narrowerScratchRoot)).toBe('resolves-a-tracker-outside-the-scratch-root');
  });

  // A developer's shell exporting the variable would otherwise point every spec at the tracker it names, whatever directory the spec chose.
  test('AGENT_PROGRESS_ROOT naming a tracker outside the scratch root is refused, where the same directory without it is isolated', () => {
    const childScratchRoot = scratchDirectory('isolation-child-root');
    const startDirectory = join(childScratchRoot, 'spec-working-directory');
    mkdirSync(startDirectory);
    const namedTrackerRoot = writeMinimalTracker(scratchDirectory('isolation-override'));
    expect(verdictFromAChildProcess({ TMPDIR: childScratchRoot }, startDirectory)).toBe('isolated');
    expect(verdictFromAChildProcess({ TMPDIR: childScratchRoot, AGENT_PROGRESS_ROOT: namedTrackerRoot }, startDirectory))
      .toBe('resolves-a-tracker-outside-the-scratch-root');
  });
});

describe('the refusal a spec helper throws', () => {
  test('refuses the repository under test before any command can run', () => {
    expect(() => requireTrackerIsolation(REPOSITORY_DIRECTORY)).toThrow('which is not isolated (directory-outside-the-scratch-root)');
  });
});
