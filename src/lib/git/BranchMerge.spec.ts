/**
 * Merging into a worktree and undoing it, against real git in scratch repositories. What matters is that each outcome is told apart (a
 * merge commit, a commit already held, a conflict naming its files), that an abort or reset lands exactly on the recorded commit, that a
 * resolution's leftovers are found, and that the repository's own hooks never run: a failing hook planted where the repository points
 * `core.hooksPath` stops a plain git merge, yet not this one.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import {
  addWorktree,
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import { fastForwardTo }            from './BranchIntegration.ts';
import {
  abortMerge,
  conflictMarkedFilesIn,
  fastForwardInto,
  mergeIn,
  resetTo,
  unmergedPathsIn
} from './BranchMerge.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

/** A repository whose own configuration names an author, since the merges under test run without the scratch `-c` identity pairs. */
function scratchRepositoryWithIdentity(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  gitOutputIn(repositoryDirectory, ['config', 'user.name', 'Alex Example']);
  gitOutputIn(repositoryDirectory, ['config', 'user.email', 'alex.example@example.com']);
  gitOutputIn(repositoryDirectory, ['config', 'commit.gpgsign', 'false']);
  return repositoryDirectory;
}

/** The main line holds `shared.txt`; `feature` changes the named file from there and the main line answers with its own change. */
function divergedRepository(prefix: string, featureFile: string, mainLineFile: string): { repositoryDirectory: string; featureCommit: string; mainLineTip: string } {
  const repositoryDirectory = scratchRepositoryWithIdentity(prefix);
  commitFile(repositoryDirectory, 'shared.txt', 'base\n');
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
  const featureCommit = commitFile(repositoryDirectory, featureFile, 'feature side\n');
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-']);
  const mainLineTip = commitFile(repositoryDirectory, mainLineFile, 'main line side\n');
  return { repositoryDirectory, featureCommit, mainLineTip };
}

function headOf(directory: string): string {
  return gitOutputIn(directory, ['rev-parse', 'HEAD']);
}

function plantFailingHooks(repositoryDirectory: string): void {
  const hooksFolder = join(repositoryDirectory, 'planted-hooks');
  mkdirSync(hooksFolder);
  for (const hookName of ['pre-commit', 'pre-merge-commit', 'commit-msg']) {
    writeFileSync(join(hooksFolder, hookName), '#!/bin/sh\necho "planted hook ran" >&2\nexit 1\n');
    chmodSync(join(hooksFolder, hookName), 0o755);
  }
  gitOutputIn(repositoryDirectory, ['config', 'core.hooksPath', hooksFolder]);
}

describeWhenGitIsPresent('merging a commit into a worktree', () => {
  test('a commit the worktree lacks is merged as a merge commit whose parents are the old tip and that commit', () => {
    const { repositoryDirectory, featureCommit, mainLineTip } = divergedRepository('branch-merge-clean', 'feature.txt', 'main.txt');
    const outcome = mergeIn(repositoryDirectory, featureCommit);
    expect(outcome.verdict).toBe('merged');
    expect(gitOutputIn(repositoryDirectory, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([mainLineTip, featureCommit]);
    expect(outcome).toEqual({ verdict: 'merged', mergeCommit: headOf(repositoryDirectory) });
  });

  test('a commit the worktree already holds reads already-descends and leaves HEAD where it was', () => {
    const repositoryDirectory = scratchRepositoryWithIdentity('branch-merge-already');
    const olderCommit = commitFile(repositoryDirectory, 'first.txt', 'one\n');
    const tip = commitFile(repositoryDirectory, 'second.txt', 'two\n');
    expect(mergeIn(repositoryDirectory, olderCommit)).toEqual({ verdict: 'already-descends', headCommit: tip });
    expect(headOf(repositoryDirectory)).toBe(tip);
  });

  test('a conflict reads conflicted with the conflicted files, and is left in place for the caller', () => {
    const { repositoryDirectory, featureCommit } = divergedRepository('branch-merge-conflict', 'shared.txt', 'shared.txt');
    expect(mergeIn(repositoryDirectory, featureCommit)).toEqual({ verdict: 'conflicted', conflictedFiles: ['shared.txt'] });
    expect(unmergedPathsIn(repositoryDirectory)).toEqual(['shared.txt']);
  });

  test('a commit that does not exist, or is shaped like an option, reads unknown-commit', () => {
    const repositoryDirectory = scratchRepositoryWithIdentity('branch-merge-unknown');
    expect(mergeIn(repositoryDirectory, 'no-such-branch')).toEqual({ verdict: 'unknown-commit' });
    expect(mergeIn(repositoryDirectory, '--abort')).toEqual({ verdict: 'unknown-commit' });
  });

  test('a planted failing hook stops a plain git merge, which proves the plant bites', () => {
    const { repositoryDirectory, featureCommit, mainLineTip } = divergedRepository('branch-merge-hook-control', 'feature.txt', 'main.txt');
    plantFailingHooks(repositoryDirectory);
    const plainMerge = Bun.spawnSync(['git', 'merge', '--no-ff', '--no-edit', featureCommit], { cwd: repositoryDirectory, stdout: 'pipe', stderr: 'pipe' });
    expect(plainMerge.exitCode).not.toBe(0);
    expect(plainMerge.stderr.toString()).toContain('planted hook ran');
    gitOutputIn(repositoryDirectory, ['merge', '--abort']);
    expect(headOf(repositoryDirectory)).toBe(mainLineTip);
  });

  test('the same planted failing hooks never run here: the merge commit is still made', () => {
    const { repositoryDirectory, featureCommit, mainLineTip } = divergedRepository('branch-merge-hook-off', 'feature.txt', 'main.txt');
    plantFailingHooks(repositoryDirectory);
    const outcome = mergeIn(repositoryDirectory, featureCommit);
    expect(outcome.verdict).toBe('merged');
    expect(gitOutputIn(repositoryDirectory, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([mainLineTip, featureCommit]);
  });
});

describeWhenGitIsPresent('undoing a merge', () => {
  test('an abort of a conflicted merge restores the pre-merge tip and a clean worktree', () => {
    const { repositoryDirectory, featureCommit, mainLineTip } = divergedRepository('branch-merge-abort', 'shared.txt', 'shared.txt');
    mergeIn(repositoryDirectory, featureCommit);
    expect(abortMerge(repositoryDirectory, mainLineTip)).toEqual({ verdict: 'restored', headCommit: mainLineTip });
    expect(gitOutputIn(repositoryDirectory, ['status', '--porcelain'])).toBe('');
    expect(readFileSync(join(repositoryDirectory, 'shared.txt'), 'utf8')).toBe('main line side\n');
  });

  test('an abort with no merge in progress is refused with git\'s reason', () => {
    const repositoryDirectory = scratchRepositoryWithIdentity('branch-merge-abort-nothing');
    const outcome = abortMerge(repositoryDirectory, headOf(repositoryDirectory));
    expect(outcome.verdict).toBe('refused');
  });

  test('an abort that leaves HEAD elsewhere than the recorded tip is refused', () => {
    const { repositoryDirectory, featureCommit } = divergedRepository('branch-merge-abort-elsewhere', 'shared.txt', 'shared.txt');
    mergeIn(repositoryDirectory, featureCommit);
    const outcome = abortMerge(repositoryDirectory, featureCommit);
    expect(outcome.verdict).toBe('refused');
  });

  test('a reset lands on the recorded commit, taking a completed merge and uncommitted edits with it', () => {
    const { repositoryDirectory, featureCommit, mainLineTip } = divergedRepository('branch-merge-reset', 'feature.txt', 'main.txt');
    mergeIn(repositoryDirectory, featureCommit);
    writeFileSync(join(repositoryDirectory, 'main.txt'), 'edited\n');
    expect(resetTo(repositoryDirectory, mainLineTip)).toEqual({ verdict: 'restored', headCommit: mainLineTip });
    expect(gitOutputIn(repositoryDirectory, ['status', '--porcelain'])).toBe('');
  });

  test('a reset to a commit that does not exist reads unknown-commit and moves nothing', () => {
    const repositoryDirectory = scratchRepositoryWithIdentity('branch-merge-reset-unknown');
    const tip = headOf(repositoryDirectory);
    expect(resetTo(repositoryDirectory, '--hard')).toEqual({ verdict: 'unknown-commit' });
    expect(headOf(repositoryDirectory)).toBe(tip);
  });
});

describeWhenGitIsPresent('a fast-forward into a named worktree', () => {
  function worktreeBehindACommit(prefix: string): { repositoryDirectory: string; worktreePath: string; aheadCommit: string } {
    const repositoryDirectory = scratchRepositoryWithIdentity(prefix);
    const worktreePath = addWorktree(repositoryDirectory, 'target');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ahead']);
    const aheadCommit = commitFile(repositoryDirectory, 'ahead.txt', 'ahead\n');
    return { repositoryDirectory, worktreePath, aheadCommit };
  }

  /** A post-merge hook cannot fail a merge, so the probe leaves a mark instead: the mark is how a spec sees that a hook ran. */
  function plantMarkingPostMergeHook(repositoryDirectory: string): string {
    const hooksFolder = join(repositoryDirectory, 'marking-hooks');
    const markPath = join(repositoryDirectory, 'post-merge-ran.txt');
    mkdirSync(hooksFolder);
    writeFileSync(join(hooksFolder, 'post-merge'), `#!/bin/sh\necho ran > '${markPath}'\n`, { mode: 0o755 });
    gitOutputIn(repositoryDirectory, ['config', 'core.hooksPath', hooksFolder]);
    return markPath;
  }

  test('a linked worktree is fast-forwarded to a commit that descends from its tip, and its repository\'s hooks do not run', () => {
    const { repositoryDirectory, worktreePath, aheadCommit } = worktreeBehindACommit('branch-merge-fast-forward');
    const markPath = plantMarkingPostMergeHook(repositoryDirectory);
    expect(fastForwardInto(worktreePath, aheadCommit)).toEqual({ verdict: 'fast-forwarded', commit: aheadCommit });
    expect(headOf(worktreePath)).toBe(aheadCommit);
    expect(existsSync(markPath)).toBe(false);
  });

  test('the release\'s own fast-forward still runs the repository\'s hooks, which proves the planted hook bites', () => {
    const { repositoryDirectory, worktreePath, aheadCommit } = worktreeBehindACommit('branch-merge-fast-forward-hooks');
    const markPath = plantMarkingPostMergeHook(repositoryDirectory);
    expect(fastForwardTo(worktreePath, aheadCommit)).toEqual({ verdict: 'fast-forwarded', commit: aheadCommit });
    expect(existsSync(markPath)).toBe(true);
  });
});

describeWhenGitIsPresent('checking a resolution', () => {
  test('a clean worktree has no unmerged paths, and one outside any repository reads null', () => {
    const repositoryDirectory = scratchRepositoryWithIdentity('branch-merge-unmerged-clean');
    expect(unmergedPathsIn(repositoryDirectory)).toEqual([]);
    expect(unmergedPathsIn(join(repositoryDirectory, 'missing'))).toBeNull();
  });

  test('a file still holding conflict markers is named; a Markdown underline alone or a missing file is not', () => {
    const { repositoryDirectory, featureCommit } = divergedRepository('branch-merge-markers', 'shared.txt', 'shared.txt');
    mergeIn(repositoryDirectory, featureCommit);
    writeFileSync(join(repositoryDirectory, 'heading.md'), 'Title\n=======\n\nBody\n');
    writeFileSync(join(repositoryDirectory, 'resolved.txt'), 'both sides, resolved\n');
    expect(conflictMarkedFilesIn(repositoryDirectory, ['shared.txt', 'heading.md', 'resolved.txt', 'deleted.txt'])).toEqual(['shared.txt']);
  });
});
