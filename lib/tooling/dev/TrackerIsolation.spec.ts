/**
 * The guard between the suite and a tracker it did not create. Each way out of the scratch root is constructed here rather than found, because the
 * repository under test may or may not hold a real tracker: a directory outside the root, a walk up that reaches a tracker above the root, and an
 * `AGENT_PROGRESS_ROOT` naming one — the last in a child process, since `lib/EnvironmentReads.spec.ts` forbids this file the accessor. The two
 * helpers every spec drives a command through must refuse before the command runs, or a refusal would be swallowed into an exit code.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
}                                                 from 'bun:test';

import { workspacePathsFor }                                   from '../../platform/Workspace';
import { createCapturedCommandContext }                        from './CapturedCommandContext';
import { runAgentProgress }                                    from './CliProcess';
import { createScratchDirectory, removeScratchDirectory }      from './ScratchWorkspace';
import { requireTrackerIsolation, trackerIsolationVerdictFor } from './TrackerIsolation';

const TRACKER_ISOLATION_MODULE_PATH = join(import.meta.dir, 'TrackerIsolation.ts');
const REPOSITORY_DIRECTORY          = join(import.meta.dir, '..', '..', '..');
const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchDirectory(prefix: string): string {
  const directory = realpathSync(createScratchDirectory(prefix));
  scratchDirectories.push(directory);
  return directory;
}

function trackerAt(rootDirectory: string): string {
  const { progressFilePath, trackerDirectory } = workspacePathsFor(rootDirectory);
  mkdirSync(trackerDirectory, { recursive: true });
  writeFileSync(progressFilePath, '{"version":1}');
  return rootDirectory;
}

/** A tracker at the top of a scratch directory, and a narrower scratch root below it, so the tracker is outside the root the guard is given. */
function trackerAboveANarrowerScratchRoot(): { narrowerScratchRoot: string; startDirectory: string } {
  const outerDirectory = trackerAt(scratchDirectory('isolation-outer'));
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
  const finished = Bun.spawnSync([process.execPath, '-e', source], {
    env:    childEnvironment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (finished.exitCode !== 0) throw new Error(`the child process failed: ${finished.stderr.toString().trim()}`);
  return JSON.parse(finished.stdout.toString().trim()) as string;
}

describe('the verdict on one directory', () => {
  test('a scratch directory holding its own tracker is isolated', () => {
    const trackedScratchDirectory = trackerAt(scratchDirectory('isolation-own'));
    expect(trackerIsolationVerdictFor(trackedScratchDirectory)).toBe('isolated');
    expect(trackerIsolationVerdictFor(join(trackedScratchDirectory, 'not-created-yet'))).toBe('isolated');
  });

  // The shape that leaked: a context defaulting to the test runner's directory, which is the repository itself.
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
    const namedTrackerRoot = trackerAt(scratchDirectory('isolation-override'));
    expect(verdictFromAChildProcess({ TMPDIR: childScratchRoot }, startDirectory)).toBe('isolated');
    expect(verdictFromAChildProcess({ TMPDIR: childScratchRoot, AGENT_PROGRESS_ROOT: namedTrackerRoot }, startDirectory))
      .toBe('resolves-a-tracker-outside-the-scratch-root');
  });
});

describe('the helpers a spec runs a command through', () => {
  test('refuse the repository under test before any command can run', async () => {
    expect(() => requireTrackerIsolation(REPOSITORY_DIRECTORY)).toThrow('which is not isolated (directory-outside-the-scratch-root)');
    expect(() => createCapturedCommandContext({ currentDirectory: REPOSITORY_DIRECTORY })).toThrow('which is not isolated');
    await expect(runAgentProgress(['ticket', 'add', 'Isolation probe'], { currentDirectory: REPOSITORY_DIRECTORY })).rejects.toThrow('which is not isolated');
  });

  // The hook resolves its tracker from the `cwd` in the JSON piped to it, not from the context, so that directory is a second way out.
  test('refuse a piped hook input whose cwd is the repository under test', () => {
    const scratchWorkingDirectory = scratchDirectory('isolation-hook');
    const standardInputText = JSON.stringify({ agent_id: 'agent_example', cwd: REPOSITORY_DIRECTORY });
    expect(() => createCapturedCommandContext({ currentDirectory: scratchWorkingDirectory, standardInputText })).toThrow('which is not isolated');
    expect(() => createCapturedCommandContext({ currentDirectory: scratchWorkingDirectory, standardInputText: 'not json' })).not.toThrow();
  });
});
