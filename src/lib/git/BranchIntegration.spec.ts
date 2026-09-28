/**
 * Every refusal git gives comes back as a verdict with git's own reason, a worktree holding work is left standing with that work named,
 * and an option-shaped branch name reads as a ref under refs/heads/.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join }                      from 'node:path';
import { afterAll, expect, test }    from 'bun:test';

import {
  addWorktree,
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import {
  deleteMergedBranch,
  fastForwardTo,
  readBranchDescent,
  readCurrentBranch,
  removeWorktree
} from './BranchIntegration.ts';

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

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

describeWhenGitIsPresent('the branch the main checkout is on', () => {
  test('a checkout on a branch reads on-branch with that branch\'s name', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-on-branch');
    expect(readCurrentBranch(repositoryDirectory)).toEqual({ verdict: 'on-branch', branch: currentBranchOf(repositoryDirectory) });
  });

  test('a detached HEAD reads detached, not as a git failure', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-detached');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '--detach']);
    expect(readCurrentBranch(repositoryDirectory)).toEqual({ verdict: 'detached' });
  });

  test('a directory outside any repository reads git-failed with git\'s own exit code and reason', () => {
    const plainDirectory = scratchDirectory('branch-integration-no-repository');
    const reading        = readCurrentBranch(plainDirectory);
    expect(reading.verdict).toBe('git-failed');
    if (reading.verdict !== 'git-failed') return;
    expect(reading.reason.startsWith('git symbolic-ref --quiet --short HEAD exited with 128: ')).toBe(true);
  });
});

describeWhenGitIsPresent('whether a branch descends from the main line', () => {
  test('a branch built on the main line\'s tip is a descendant, with both commits named', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-descendant');
    const mainLine            = currentBranchOf(repositoryDirectory);
    const mainLineCommit      = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');

    expect(readBranchDescent(repositoryDirectory, 'feature', mainLine)).toEqual({ verdict: 'descendant', branchCommit, mainLineCommit });
  });

  test('a branch missing a commit the main line gained is not a descendant', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-not-descendant');
    const mainLine            = currentBranchOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    const mainLineCommit = commitFile(repositoryDirectory, 'main.txt', 'main\n');

    expect(readBranchDescent(repositoryDirectory, 'feature', mainLine)).toEqual({ verdict: 'not-a-descendant', branchCommit, mainLineCommit });
  });

  test('a branch that does not exist reads unknown-branch', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-unknown-branch');
    expect(readBranchDescent(repositoryDirectory, 'no-such-branch', currentBranchOf(repositoryDirectory))).toEqual({ verdict: 'unknown-branch' });
  });

  test('a main line that does not exist reads unknown-main-line', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-unknown-main-line');
    gitOutputIn(repositoryDirectory, ['branch', 'feature']);
    expect(readBranchDescent(repositoryDirectory, 'feature', 'no-such-main-line')).toEqual({ verdict: 'unknown-main-line' });
  });

  // A branch name comes from a caller; it is read under refs/heads/, so an option-shaped one is only ever a ref name.
  test('a branch named like an option that does not exist reads unknown-branch and writes no file', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-option-branch');
    expect(readBranchDescent(repositoryDirectory, '--output=x', currentBranchOf(repositoryDirectory))).toEqual({ verdict: 'unknown-branch' });
    expect(existsSync(join(repositoryDirectory, 'x'))).toBe(false);
  });

  test('a branch named like an option that does exist is read as that branch', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-option-branch-present');
    const mainLine            = currentBranchOf(repositoryDirectory);
    const mainLineCommit      = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    gitOutputIn(repositoryDirectory, ['update-ref', 'refs/heads/--output=x', mainLineCommit]);

    expect(readBranchDescent(repositoryDirectory, '--output=x', mainLine)).toEqual({ verdict: 'descendant', branchCommit: mainLineCommit, mainLineCommit });
    expect(existsSync(join(repositoryDirectory, 'x'))).toBe(false);
  });
});

describeWhenGitIsPresent('the fast-forward', () => {
  test('a commit ahead of the main line is fast-forwarded to and left at HEAD', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-fast-forward');
    const mainLine            = currentBranchOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);

    expect(fastForwardTo(repositoryDirectory, branchCommit)).toEqual({ verdict: 'fast-forwarded', commit: branchCommit });
    expect(gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD'])).toBe(branchCommit);
  });

  test('a main line that has diverged is refused with git\'s reason, and HEAD stays where it was', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-diverged');
    const mainLine            = currentBranchOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const branchCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    const mainLineCommit = commitFile(repositoryDirectory, 'main.txt', 'main\n');

    const outcome = fastForwardTo(repositoryDirectory, branchCommit);
    expect(outcome.verdict).toBe('refused');
    if (outcome.verdict !== 'refused') return;
    expect(outcome.reason.startsWith(`git merge --ff-only --quiet ${branchCommit} exited with`)).toBe(true);
    expect(outcome.blockingFiles).toEqual([]);
    expect(gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD'])).toBe(mainLineCommit);
  });

  test('a refusal over uncommitted work names the changed and untracked files the merge would overwrite, and no other uncommitted file', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-blocking-files');
    const mainLine            = currentBranchOf(repositoryDirectory);
    commitFile(repositoryDirectory, 'shared.md', 'shared\n');
    commitFile(repositoryDirectory, 'untouched.md', 'untouched\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    commitFile(repositoryDirectory, 'shared.md', 'feature\n');
    const branchCommit = commitFile(repositoryDirectory, 'new file.md', 'feature\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    const mainLineCommit = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    writeFileSync(join(repositoryDirectory, 'shared.md'), 'edited by hand\n');
    writeFileSync(join(repositoryDirectory, 'new file.md'), 'left untracked\n');
    writeFileSync(join(repositoryDirectory, 'untouched.md'), 'edited by hand\n');

    const outcome = fastForwardTo(repositoryDirectory, branchCommit);
    expect(outcome.verdict).toBe('refused');
    if (outcome.verdict !== 'refused') return;
    expect(outcome.blockingFiles.toSorted()).toEqual(['new file.md', 'shared.md']);
    expect(gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD'])).toBe(mainLineCommit);
  });

  // Rename detection would report only the new path, while git refuses over the old one the merge removes.
  test('a refusal over a file the branch renames names the path it was renamed from', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-renamed-blocking-file');
    const mainLine            = currentBranchOf(repositoryDirectory);
    commitFile(repositoryDirectory, 'before.md', 'one\ntwo\nthree\nfour\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    gitOutputIn(repositoryDirectory, ['mv', 'before.md', 'after.md']);
    gitOutputIn(repositoryDirectory, ['commit', '-q', '-m', 'Rename the file']);
    const branchCommit = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    writeFileSync(join(repositoryDirectory, 'before.md'), 'edited by hand\n');

    const outcome = fastForwardTo(repositoryDirectory, branchCommit);
    expect(outcome.verdict).toBe('refused');
    if (outcome.verdict !== 'refused') return;
    expect(outcome.blockingFiles).toEqual(['before.md']);
  });
});

describeWhenGitIsPresent('removing the worktree', () => {
  test('a clean worktree is removed', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-clean-worktree');
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    expect(removeWorktree(repositoryDirectory, worktreeDirectory)).toEqual({ verdict: 'removed' });
    expect(existsSync(worktreeDirectory)).toBe(false);
  });

  // Never forced: the files git would lose are named, unquoted, so a person can decide what to keep.
  test('a worktree holding an untracked file and a changed one is left standing, with both named', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-dirty-worktree');
    gitOutputIn(repositoryDirectory, ['config', 'core.quotePath', 'true']);
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

describeWhenGitIsPresent('deleting the merged branch', () => {
  test('a branch the main checkout\'s HEAD holds is deleted', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-merged-branch');
    gitOutputIn(repositoryDirectory, ['branch', 'merged-work']);

    expect(deleteMergedBranch(repositoryDirectory, 'merged-work')).toEqual({ verdict: 'deleted' });
    expect(gitOutputIn(repositoryDirectory, ['branch', '--list', 'merged-work'])).toBe('');
  });

  test('a branch holding unmerged work is left, with git\'s reason', () => {
    const repositoryDirectory = scratchGitRepository('branch-integration-unmerged-branch');
    const mainLine            = currentBranchOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'unmerged-work']);
    commitFile(repositoryDirectory, 'feature.txt', 'feature\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);

    const outcome = deleteMergedBranch(repositoryDirectory, 'unmerged-work');
    expect(outcome.verdict).toBe('left');
    if (outcome.verdict !== 'left') return;
    expect(outcome.reason.startsWith('git branch -d')).toBe(true);
    expect(gitOutputIn(repositoryDirectory, ['branch', '--list', 'unmerged-work'])).not.toBe('');
  });
});
