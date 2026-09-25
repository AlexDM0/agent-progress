/**
 * `init` beside `AGENT_PROGRESS_ROOT`, through the real binary because no spec may set the environment in-process. The case that
 * matters is an override naming a folder without a tracker while `init` runs in a tracked repository: it once wrote an empty store over
 * that repository's rows and log. Every case compares the progress files' bytes, since an exit code alone cannot show nothing was lost.
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
import { runAgentProgress }                                                   from '../lib/tooling/dev/CliProcess';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../lib/tooling/dev/ScratchWorkspace';

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

function progressFileHashOf(repositoryDirectory: string): string {
  return createHash('sha256').update(readFileSync(progressFilePathOf(repositoryDirectory))).digest('hex');
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
    const hashBefore         = progressFileHashOf(trackedDirectory);

    const result = await runAgentProgress(['init', '--project', 'Example Agency'], {
      currentDirectory: trackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: untrackedDirectory },
    });

    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('AGENT_PROGRESS_ROOT');
    expect(result.standardError).toContain(trackedDirectory);
    expect(result.standardError).toContain(untrackedDirectory);
    expect(progressFileHashOf(trackedDirectory)).toBe(hashBefore);
    expect(existsSync(progressFilePathOf(untrackedDirectory))).toBe(false);
  });

  test('an override naming the tracked repository itself refreshes it like update, at exit 0, with its progress file unchanged', async () => {
    const trackedDirectory = await trackedRepositoryWithARowAndALogLine();
    const hashBefore       = progressFileHashOf(trackedDirectory);

    const result = await runAgentProgress(['init'], {
      currentDirectory: trackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: trackedDirectory },
    });

    expect(result.exitCode).toBe(0);
    expect(result.standardOutput).toContain('agent-progress is already initialised');
    expect(progressFileHashOf(trackedDirectory)).toBe(hashBefore);
  });

  test('with the override unset, init in a tracked repository still refreshes it at exit 0, its progress file unchanged', async () => {
    const trackedDirectory = await trackedRepositoryWithARowAndALogLine();
    const hashBefore       = progressFileHashOf(trackedDirectory);

    const result = await runAgentProgress(['init'], { currentDirectory: trackedDirectory, environment: {} });

    expect(result.exitCode).toBe(0);
    expect(result.standardOutput).toContain('agent-progress is already initialised');
    expect(progressFileHashOf(trackedDirectory)).toBe(hashBefore);
  });

  test('--root naming a different directory from the override is refused at exit 1, naming both, and writes nothing there', async () => {
    const trackedDirectory   = await trackedRepositoryWithARowAndALogLine();
    const untrackedDirectory = scratchRepository('init-override-root');
    const hashBefore         = progressFileHashOf(trackedDirectory);

    const result = await runAgentProgress(['init', '--root', untrackedDirectory], {
      currentDirectory: trackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: trackedDirectory },
    });

    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('AGENT_PROGRESS_ROOT');
    expect(result.standardError).toContain(trackedDirectory);
    expect(result.standardError).toContain(untrackedDirectory);
    expect(existsSync(join(untrackedDirectory, '.agent-progress'))).toBe(false);
    expect(progressFileHashOf(trackedDirectory)).toBe(hashBefore);
  });

  test('--root naming the directory the override names creates the tracker there at exit 0', async () => {
    const untrackedDirectory = scratchRepository('init-override-agreeing-root');

    const result = await runAgentProgress(['init', '--root', untrackedDirectory], {
      currentDirectory: untrackedDirectory,
      environment:      { AGENT_PROGRESS_ROOT: untrackedDirectory },
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(progressFilePathOf(untrackedDirectory))).toBe(true);
  });
});
