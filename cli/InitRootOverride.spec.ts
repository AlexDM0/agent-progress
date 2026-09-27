/**
 * `init` beside `AGENT_PROGRESS_ROOT`, through the real binary because no spec may set the environment in-process. The case that
 * matters is an override naming a folder without a tracker while `init` runs in a tracked repository: it must leave that repository's rows
 * and log untouched, not write an empty store over them. Every case compares the bytes of the tracker's progress.json and log.jsonl
 * together, since an exit code alone cannot show nothing was lost.
 */
import { createHash }                             from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
}                                                              from 'bun:test';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { MULTI_PROCESS_CASE_TIMEOUT_MILLISECONDS, runAgentProgress }          from './testing/CliProcess.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function scratchRepository(prefix: string): string {
  const repositoryDirectory = realpathSync(createScratchGitRepository(prefix));
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

function progressFilePathOf(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.agent-progress', 'progress.json');
}

function trackerFilesHashOf(repositoryDirectory: string): string {
  return createHash('sha256')
    .update(readFileSync(progressFilePathOf(repositoryDirectory)))
    .update(readFileSync(join(repositoryDirectory, '.agent-progress', 'log.jsonl')))
    .digest('hex');
}

async function trackedRepositoryWithARowAndALogLine(): Promise<string> {
  const repositoryDirectory = scratchRepository('init-override-tracked');
  const cleanEnvironment = { environment: {}, currentDirectory: repositoryDirectory };
  expect((await runAgentProgress(['init', '--project', 'Example Agency'], cleanEnvironment)).exitCode).toBe(0);
  expect((await runAgentProgress(['task', 'add', 'Draft the example page'], cleanEnvironment)).exitCode).toBe(0);
  expect((await runAgentProgress(['log', 'Example session started'], cleanEnvironment)).exitCode).toBe(0);
  return repositoryDirectory;
}

describe.skipIf(!gitIsAvailable())('init with AGENT_PROGRESS_ROOT set', () => {
  // The reported loss: the override said "no tracker here", and `init` created one where it stood.
  test('an override naming an untracked repository is refused at exit 1, naming both, and neither progress file changes', async () => {
    const trackedDirectory   = await trackedRepositoryWithARowAndALogLine();
    const untrackedDirectory = scratchRepository('init-override-untracked');
    const hashBefore         = trackerFilesHashOf(trackedDirectory);

    const result = await runAgentProgress(['init', '--project', 'Example Agency'], {
      currentDirectory: trackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: untrackedDirectory },
    });

    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('AGENT_PROGRESS_ROOT');
    expect(result.standardError).toContain(trackedDirectory);
    expect(result.standardError).toContain(untrackedDirectory);
    expect(trackerFilesHashOf(trackedDirectory)).toBe(hashBefore);
    expect(existsSync(progressFilePathOf(untrackedDirectory))).toBe(false);
  }, MULTI_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('an override naming the tracked repository itself refreshes it like update, at exit 0, with its progress file unchanged', async () => {
    const trackedDirectory = await trackedRepositoryWithARowAndALogLine();
    const hashBefore       = trackerFilesHashOf(trackedDirectory);

    const result = await runAgentProgress(['init'], {
      currentDirectory: trackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: trackedDirectory },
    });

    expect(result.exitCode).toBe(0);
    expect(result.standardOutput).toContain('agent-progress is already initialised');
    expect(trackerFilesHashOf(trackedDirectory)).toBe(hashBefore);
  }, MULTI_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('with the override unset, init in a tracked repository still refreshes it at exit 0, its progress file unchanged', async () => {
    const trackedDirectory = await trackedRepositoryWithARowAndALogLine();
    const hashBefore       = trackerFilesHashOf(trackedDirectory);

    const result = await runAgentProgress(['init'], { currentDirectory: trackedDirectory, environment: {} });

    expect(result.exitCode).toBe(0);
    expect(result.standardOutput).toContain('agent-progress is already initialised');
    expect(trackerFilesHashOf(trackedDirectory)).toBe(hashBefore);
  }, MULTI_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('--root naming a different directory from the override is refused at exit 1, naming both, and writes nothing there', async () => {
    const trackedDirectory   = await trackedRepositoryWithARowAndALogLine();
    const untrackedDirectory = scratchRepository('init-override-root');
    const hashBefore         = trackerFilesHashOf(trackedDirectory);

    const result = await runAgentProgress(['init', '--root', untrackedDirectory], {
      currentDirectory: trackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: trackedDirectory },
    });

    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('AGENT_PROGRESS_ROOT');
    expect(result.standardError).toContain(trackedDirectory);
    expect(result.standardError).toContain(untrackedDirectory);
    expect(existsSync(join(untrackedDirectory, '.agent-progress'))).toBe(false);
    expect(trackerFilesHashOf(trackedDirectory)).toBe(hashBefore);
  }, MULTI_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('--root naming the directory the override names creates the tracker there at exit 0', async () => {
    const untrackedDirectory = scratchRepository('init-override-agreeing-root');

    const result = await runAgentProgress(['init', '--root', untrackedDirectory], {
      currentDirectory: untrackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: untrackedDirectory },
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(progressFilePathOf(untrackedDirectory))).toBe(true);
  }, MULTI_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});
