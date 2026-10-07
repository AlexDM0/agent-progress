/**
 * `view-spec` through the real binary, since the refusal under `AGENT_PROGRESS_ROOT` needs the child's environment. What matters is what it
 * leaves alone: in a repository with no tracker it creates exactly its two files and no tracker (a later `init` still succeeds), in a tracked
 * one it changes no tracker file, and a stale install does not stop it. Every refusal writes nothing, and no case passes `--open` where a
 * page would be found, so no spec launches a browser.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join, sep } from 'node:path';

import { afterEach, expect, test }                                                    from 'bun:test';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }                                    from '../src/testing/ChildProcessCaseTimeout.ts';
import { createScratchDirectory, createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { writeExampleSpecKitRepository }                                              from '../src/testing/SpecKitRepositoryFixtures.ts';
import { describeWhenGitIsPresent }                                                   from '../src/testing/ToolGuard.ts';
import { runAgentProgress }                                                           from './testing/CliProcess.ts';

const TRACKER_DIRECTORY_NAME = '.agent-progress';

const GIT_DIRECTORY_NAME = '.git';

const SPEC_VIEW_FILE_NAMES = ['progress-spec.html', 'progress-spec.json'];

const TRACKER_FILE_NAMES = ['progress.json', 'log.jsonl', 'progress.html', 'version.json'];

const NO_SPEC_KIT_WORDING = 'No spec-kit project (a .specify/ folder) was found in';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function kept(directory: string): string {
  const canonicalDirectory = realpathSync(directory);
  scratchDirectories.push(canonicalDirectory);
  return canonicalDirectory;
}

function specKitRepository(prefix: string): string {
  const repositoryDirectory = kept(createScratchGitRepository(prefix));
  writeExampleSpecKitRepository(repositoryDirectory, { datesFilesInThePast: true });
  return repositoryDirectory;
}

/** Every file outside `.git/` and the tracker folder, by its path relative to the repository, with its bytes. */
function repositoryFilesOf(repositoryDirectory: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const relativePath of readdirSync(repositoryDirectory, { recursive: true, encoding: 'utf8' }).sort()) {
    const topFolder = relativePath.split(sep)[0];
    if (topFolder === GIT_DIRECTORY_NAME || topFolder === TRACKER_DIRECTORY_NAME) continue;
    const filePath = join(repositoryDirectory, relativePath);
    if (statSync(filePath).isFile()) files.set(relativePath, readFileSync(filePath, 'base64'));
  }
  return files;
}

function trackerFilesOf(repositoryDirectory: string): string[] {
  return TRACKER_FILE_NAMES.map((fileName) => readFileSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME, fileName), 'base64'));
}

describeWhenGitIsPresent('view-spec in a spec-kit repository', () => {
  test('without a tracker it prints the page path, leaves exactly its two files and no tracker, and a later init succeeds', async () => {
    const repositoryDirectory = specKitRepository('view-spec-untracked');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/\n');
    const filesBefore = repositoryFilesOf(repositoryDirectory);
    expect(filesBefore.size).toBeGreaterThan(5);

    const result = await runAgentProgress(['view-spec'], { currentDirectory: repositoryDirectory, environment: {} });

    expect(result.exitCode, result.standardError).toBe(0);
    expect(result.standardOutput).toBe(`${join(repositoryDirectory, TRACKER_DIRECTORY_NAME, 'progress-spec.html')}\n`);
    expect(readdirSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME)).sort()).toEqual(SPEC_VIEW_FILE_NAMES);
    expect(repositoryFilesOf(repositoryDirectory)).toEqual(filesBefore);

    const initResult = await runAgentProgress(['init', '--project', 'Example Agency'], { currentDirectory: repositoryDirectory, environment: {} });
    expect(initResult.exitCode, initResult.standardError).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('with a tracker it leaves progress.json, log.jsonl, progress.html and version.json byte-identical', async () => {
    const repositoryDirectory = specKitRepository('view-spec-tracked');
    const options             = { currentDirectory: repositoryDirectory, environment: {} };
    expect((await runAgentProgress(['init', '--project', 'Example Agency'], options)).exitCode).toBe(0);
    expect((await runAgentProgress(['log', 'Example session started'], options)).exitCode).toBe(0);
    const trackerFilesBefore = trackerFilesOf(repositoryDirectory);

    const result = await runAgentProgress(['view-spec'], options);

    expect(result.exitCode, result.standardError).toBe(0);
    expect(trackerFilesOf(repositoryDirectory)).toEqual(trackerFilesBefore);
    expect(existsSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME, 'progress-spec.html'))).toBe(true);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('over installed files of another install version it still runs, where a checked command is refused', async () => {
    const repositoryDirectory = specKitRepository('view-spec-stale-install');
    const options             = { currentDirectory: repositoryDirectory, environment: {} };
    expect((await runAgentProgress(['init', '--project', 'Example Agency'], options)).exitCode).toBe(0);
    rmSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME, 'version.json'));
    expect((await runAgentProgress(['log', 'Example session started'], options)).exitCode).toBe(1);

    const result = await runAgentProgress(['view-spec'], options);

    expect(result.exitCode, result.standardError).toBe(0);
    expect(result.standardOutput).toBe(`${join(repositoryDirectory, TRACKER_DIRECTORY_NAME, 'progress-spec.html')}\n`);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

test('view-spec where no .specify/ is at or above the directory exits 1 with the wording, prints nothing and creates no tracker folder', async () => {
  const plainDirectory = kept(createScratchDirectory('view-spec-plain'));

  const result = await runAgentProgress(['view-spec'], { currentDirectory: plainDirectory, environment: {} });

  expect(result.exitCode).toBe(1);
  expect(result.standardError).toContain(`${NO_SPEC_KIT_WORDING} ${plainDirectory} or any directory above it`);
  expect(result.standardError).toContain('`specify init`');
  expect(result.standardOutput).toBe('');
  expect(existsSync(join(plainDirectory, TRACKER_DIRECTORY_NAME))).toBe(false);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('view-spec --open where no .specify/ is found is the same refusal, so the flag is accepted and nothing is launched', async () => {
  const plainDirectory = kept(createScratchDirectory('view-spec-open-plain'));

  const result = await runAgentProgress(['view-spec', '--open'], { currentDirectory: plainDirectory, environment: {} });

  expect(result.exitCode).toBe(1);
  expect(result.standardError).toContain(`${NO_SPEC_KIT_WORDING} ${plainDirectory} or any directory above it`);
  expect(result.standardOutput).toBe('');
  expect(existsSync(join(plainDirectory, TRACKER_DIRECTORY_NAME))).toBe(false);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('view-spec with AGENT_PROGRESS_ROOT naming a directory without .specify/ exits 1 naming that directory and the variable', async () => {
  const repositoryDirectory = kept(createScratchDirectory('view-spec-override-start'));
  writeExampleSpecKitRepository(repositoryDirectory, { datesFilesInThePast: true });
  const overrideDirectory  = kept(createScratchDirectory('view-spec-override-plain'));

  const result = await runAgentProgress(['view-spec'], {
    currentDirectory: repositoryDirectory,
    environment:      { AGENT_PROGRESS_ROOT: overrideDirectory },
  });

  expect(result.exitCode).toBe(1);
  expect(result.standardError).toContain(`${NO_SPEC_KIT_WORDING} ${overrideDirectory}, which AGENT_PROGRESS_ROOT names`);
  expect(result.standardOutput).toBe('');
  expect(existsSync(join(overrideDirectory, TRACKER_DIRECTORY_NAME))).toBe(false);
  expect(existsSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME))).toBe(false);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
