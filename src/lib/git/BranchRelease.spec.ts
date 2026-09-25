/**
 * The verdicts a release acts on, against real git in scratch repositories: which branch the main checkout is on, whether a branch
 * descends from the main line, the fast-forward, and the two cleanups. What matters is that every refusal git gives comes back as a
 * verdict with git's own reason, that a worktree holding work is left standing with that work named, and that a branch name shaped like an
 * option is looked up rather than obeyed.
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
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace';
import {
  deleteMergedBranch,
  fastForwardTo,
  readBranchDescent,
  readCurrentBranch,
  removeWorktree
} from './BranchRelease';

const COMMIT_IDENTITY_ARGUMENTS = ['-c', 'user.name=Alex Example', '-c', 'user.email=alex.example@example.com', '-c', 'commit.gpgsign=false'];

const scratchDirectories: string[] = [];

function scratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

function scratchDirectory(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

function runGit(workingDirectory: string, gitArguments: readonly string[]): string {
  const finished = Bun.spawnSync(['git', ...gitArguments], { cwd: workingDirectory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed in ${workingDirectory}: ${new TextDecoder().decode(finished.stderr).trim()}`);
  }
  return new TextDecoder().decode(finished.stdout).trim();
}

function commitFile(repositoryDirectory: string, fileName: string, content: string): string {
  writeFileSync(join(repositoryDirectory, fileName), content);
  runGit(repositoryDirectory, ['add', '--', fileName]);
  runGit(repositoryDirectory, [...COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', `Change ${fileName}`]);
  return runGit(repositoryDirectory, ['rev-parse', 'HEAD']);
}

function mainLineOf(repositoryDirectory: string): string {
  return runGit(repositoryDirectory, ['symbolic-ref', '--short', 'HEAD']);
}

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('the branch the main checkout is on', () => {
  test('a checkout on a branch reads on-branch with that branch\'s name', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-on-branch');
    expect(readCurrentBranch(repositoryDirectory)).toEqual({ verdict: 'on-branch', branch: mainLineOf(repositoryDirectory) });
  });

  test('a detached HEAD reads detached, not as a git failure', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-detached');
    runGit(repositoryDirectory, ['checkout', '-q', '--detach']);
    expect(readCurrentBranch(repositoryDirectory)).toEqual({ verdict: 'detached' });
  });

  test('a directory outside any repository reads git-failed with git\'s own exit code and reason', () => {
    const plainDirectory = scratchDirectory('branch-release-no-repository');
    const reading        = readCurrentBranch(plainDirectory);
    expect(reading.verdict).toBe('git-failed');
    if (reading.verdict !== 'git-failed') return;
    expect(reading.reason.startsWith('git symbolic-ref --quiet --short HEAD exited with 128: ')).toBe(true);
  });
});

describe.skipIf(!gitIsAvailable())('whether a branch descends from the main line', () => {
  test('a branch built on the main line\'s tip is a descendant, with both commits named', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-descendant');
    const mainLine            = mainLineOf(repositoryDirectory);
    const mainLineCommit      = runGit(repositoryDirectory, ['rev-parse', 'HEAD']);
    runGit(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');

    expect(readBranchDescent(repositoryDirectory, 'feature', mainLine)).toEqual({ verdict: 'descendant', branchCommit, mainLineCommit });
  });

  test('a branch missing a commit the main line gained is not a descendant', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-not-descendant');
    const mainLine            = mainLineOf(repositoryDirectory);
    runGit(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    runGit(repositoryDirectory, ['checkout', '-q', mainLine]);
    const mainLineCommit = commitFile(repositoryDirectory, 'main.txt', 'main\n');

    expect(readBranchDescent(repositoryDirectory, 'feature', mainLine)).toEqual({ verdict: 'not-a-descendant', branchCommit, mainLineCommit });
  });

  test('a branch that does not exist reads unknown-branch', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-unknown-branch');
    expect(readBranchDescent(repositoryDirectory, 'no-such-branch', mainLineOf(repositoryDirectory))).toEqual({ verdict: 'unknown-branch' });
  });

  test('a main line that does not exist reads unknown-main-line', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-unknown-main-line');
    runGit(repositoryDirectory, ['branch', 'feature']);
    expect(readBranchDescent(repositoryDirectory, 'feature', 'no-such-main-line')).toEqual({ verdict: 'unknown-main-line' });
  });

  // A branch name comes from a ticket a person or an agent wrote, so an option-shaped one must never reach git as an option.
  test('a branch named like an option is looked up, reads unknown-branch, and writes no file', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-option-branch');
    expect(readBranchDescent(repositoryDirectory, '--output=x', mainLineOf(repositoryDirectory))).toEqual({ verdict: 'unknown-branch' });
    expect(existsSync(join(repositoryDirectory, 'x'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('the fast-forward', () => {
  test('a commit ahead of the main line is fast-forwarded to and left at HEAD', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-fast-forward');
    const mainLine            = mainLineOf(repositoryDirectory);
    runGit(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    runGit(repositoryDirectory, ['checkout', '-q', mainLine]);

    expect(fastForwardTo(repositoryDirectory, branchCommit)).toEqual({ verdict: 'fast-forwarded', commit: branchCommit });
    expect(runGit(repositoryDirectory, ['rev-parse', 'HEAD'])).toBe(branchCommit);
  });

  test('a main line that has diverged is refused with git\'s reason, and HEAD stays where it was', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-diverged');
    const mainLine            = mainLineOf(repositoryDirectory);
    runGit(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    runGit(repositoryDirectory, ['checkout', '-q', mainLine]);
    const mainLineCommit = commitFile(repositoryDirectory, 'main.txt', 'main\n');

    const outcome = fastForwardTo(repositoryDirectory, branchCommit);
    expect(outcome.verdict).toBe('refused');
    if (outcome.verdict !== 'refused') return;
    expect(outcome.reason.startsWith(`git merge --ff-only --quiet ${branchCommit} exited with`)).toBe(true);
    expect(runGit(repositoryDirectory, ['rev-parse', 'HEAD'])).toBe(mainLineCommit);
  });
});

describe.skipIf(!gitIsAvailable())('removing the worktree', () => {
  test('a clean worktree is removed', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-clean-worktree');
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    expect(removeWorktree(repositoryDirectory, worktreeDirectory)).toEqual({ verdict: 'removed' });
    expect(existsSync(worktreeDirectory)).toBe(false);
  });

  // Never forced: the files git would lose are named, unquoted, so a person can decide what to keep.
  test('a worktree holding an untracked file and a changed one is left standing, with both named', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-dirty-worktree');
    commitFile(repositoryDirectory, 'tracked.txt', 'original\n');
    const worktreeDirectory = addWorktree(repositoryDirectory, 'subagent');
    writeFileSync(join(worktreeDirectory, 'tracked.txt'), 'changed\n');
    writeFileSync(join(worktreeDirectory, 'café.txt'), 'untracked\n');

    const outcome = removeWorktree(repositoryDirectory, worktreeDirectory);
    expect(outcome.verdict).toBe('left');
    if (outcome.verdict !== 'left') return;
    expect(outcome.reason.startsWith(`git worktree remove ${worktreeDirectory} exited with`)).toBe(true);
    expect(outcome.filesLeft).toEqual({ untrackedFiles: ['café.txt'], changedFiles: ['tracked.txt'] });
    expect(existsSync(worktreeDirectory)).toBe(true);
  });
});

describe.skipIf(!gitIsAvailable())('deleting the released branch', () => {
  test('a branch the main checkout\'s HEAD holds is deleted', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-merged-branch');
    runGit(repositoryDirectory, ['branch', 'merged-work']);

    expect(deleteMergedBranch(repositoryDirectory, 'merged-work')).toEqual({ verdict: 'deleted' });
    expect(runGit(repositoryDirectory, ['branch', '--list', 'merged-work'])).toBe('');
  });

  test('a branch holding unmerged work is left, with git\'s reason', () => {
    const repositoryDirectory = scratchGitRepository('branch-release-unmerged-branch');
    const mainLine            = mainLineOf(repositoryDirectory);
    runGit(repositoryDirectory, ['checkout', '-q', '-b', 'unmerged-work']);
    commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    runGit(repositoryDirectory, ['checkout', '-q', mainLine]);

    const outcome = deleteMergedBranch(repositoryDirectory, 'unmerged-work');
    expect(outcome.verdict).toBe('left');
    if (outcome.verdict !== 'left') return;
    expect(outcome.reason.startsWith('git branch -d')).toBe(true);
    expect(runGit(repositoryDirectory, ['branch', '--list', 'unmerged-work'])).not.toBe('');
  });
});
