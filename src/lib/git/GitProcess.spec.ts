/**
 * The one git runner, against real git in scratch repositories. What matters is what every caller parses: standard output arrives raw so a
 * caller decides what to trim, standard error arrives trimmed for a reason text, a path is printed unquoted, a git that cannot be started
 * reads as null rather than a throw, and a revision shaped like an option is looked up rather than obeyed.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join }                      from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace';
import { GitProcess } from './GitProcess';

const {
  directoryExists,
  failureReasonOf,
  resolvedCommitOf,
  run,
  succeeded,
} = GitProcess;

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

const scratchDirectories: string[] = [];

function scratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('a git run', () => {
  test('a successful command answers exit 0 with its standard output untrimmed', () => {
    const repositoryDirectory = scratchGitRepository('git-process-success');
    expect(run(repositoryDirectory, ['rev-parse', '--is-inside-work-tree'])).toEqual({
      exitCode:       0,
      standardOutput: 'true\n',
      standardError:  '',
    });
  });

  test('a failing command answers its own exit code with standard error trimmed', () => {
    const repositoryDirectory = scratchGitRepository('git-process-failure');
    expect(run(repositoryDirectory, ['rev-parse', '--verify', 'refs/heads/no-such-branch'])).toEqual({
      exitCode:       128,
      standardOutput: '',
      standardError:  'fatal: Needed a single revision',
    });
  });

  // BranchIntegration names the files a worktree still holds from this output, so a quoted, octal-escaped name would name no file at all.
  test('a non-ASCII file name is printed unquoted, whatever the user\'s own configuration says', () => {
    const repositoryDirectory = scratchGitRepository('git-process-unquoted');
    writeFileSync(join(repositoryDirectory, 'café.txt'), 'content\n');
    const finishedRun = run(repositoryDirectory, ['status', '--porcelain=v1', '--untracked-files=all']);
    expect(finishedRun?.standardOutput).toBe('?? café.txt\n');
  });

  test('a working directory that does not exist reads as git not started, never as a throw', () => {
    const parentDirectory = createScratchDirectory('git-process-missing');
    scratchDirectories.push(parentDirectory);
    expect(run(join(parentDirectory, 'missing'), ['status'])).toBeNull();
  });
});

describe('the reason a failed run gives', () => {
  test('a run that could not be started names the command and says so', () => {
    expect(failureReasonOf(null, ['merge', '--ff-only', 'abc'])).toBe('git merge --ff-only abc could not be started.');
  });

  test('a run that failed names the command, its exit code and its standard error', () => {
    const finishedRun = { exitCode: 128, standardOutput: '', standardError: 'fatal: Needed a single revision' };
    expect(failureReasonOf(finishedRun, ['rev-parse', 'HEAD'])).toBe('git rev-parse HEAD exited with 128: fatal: Needed a single revision');
  });
});

describe('whether a run succeeded', () => {
  test('a run that could not be started did not succeed', () => {
    expect(succeeded(null)).toBe(false);
  });

  test('a run that exited non-zero did not succeed', () => {
    expect(succeeded({ exitCode: 1, standardOutput: '', standardError: '' })).toBe(false);
  });

  test('a run that exited 0 succeeded', () => {
    expect(succeeded({ exitCode: 0, standardOutput: 'true\n', standardError: '' })).toBe(true);
  });
});

describe('whether a directory exists to run git in', () => {
  test('a scratch directory exists', () => {
    const directory = createScratchDirectory('git-process-directory');
    scratchDirectories.push(directory);
    expect(directoryExists(directory)).toBe(true);
  });

  test('a file is not a directory', () => {
    const directory = createScratchDirectory('git-process-file');
    scratchDirectories.push(directory);
    const filePath = join(directory, 'example.txt');
    writeFileSync(filePath, 'content\n');
    expect(directoryExists(filePath)).toBe(false);
  });

  test('a missing path is not a directory', () => {
    const directory = createScratchDirectory('git-process-missing-path');
    scratchDirectories.push(directory);
    expect(directoryExists(join(directory, 'missing'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('resolving a revision to a commit', () => {
  test('HEAD resolves to its full commit', () => {
    const repositoryDirectory = scratchGitRepository('git-process-head');
    expect(resolvedCommitOf(repositoryDirectory, 'HEAD')).toMatch(FULL_COMMIT_PATTERN);
  });

  test('an unknown revision resolves to null', () => {
    const repositoryDirectory = scratchGitRepository('git-process-unknown');
    expect(resolvedCommitOf(repositoryDirectory, 'no-such-branch')).toBeNull();
  });

  // A revision can come from text a person or an agent wrote; only `--end-of-options` lets one shaped like an option be looked up as a ref.
  test('an option-shaped revision is looked up as a revision: a ref of that name resolves to its commit, and no file is written', () => {
    const repositoryDirectory = scratchGitRepository('git-process-option-shaped');
    expect(run(repositoryDirectory, ['update-ref', 'refs/heads/--output=x', 'HEAD'])?.exitCode).toBe(0);
    expect(resolvedCommitOf(repositoryDirectory, '--output=x')).toBe(resolvedCommitOf(repositoryDirectory, 'HEAD'));
    expect(existsSync(join(repositoryDirectory, 'x'))).toBe(false);
  });

  test('an option-shaped revision with no such ref resolves to null and writes no file', () => {
    const repositoryDirectory = scratchGitRepository('git-process-option-shaped-missing');
    expect(resolvedCommitOf(repositoryDirectory, '--output=x')).toBeNull();
    expect(existsSync(join(repositoryDirectory, 'x'))).toBe(false);
  });
});
