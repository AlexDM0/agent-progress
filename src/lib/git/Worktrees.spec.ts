/**
 * Preparing and repairing worktrees, against real git in scratch repositories. What matters is that a new worktree starts exactly at the
 * recorded commit, under the given folder, on its own new branch; that a vanished worktree's record is pruned; that a stale index.lock is
 * found where git keeps it for a linked worktree; and that the saved patch holds tracked edits and untracked files alike and re-applies,
 * while a save that cannot be written is refused.
 */
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import {
  addWorktree,
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import {
  addWorktreeFromCommit,
  pruneWorktrees,
  removeStaleIndexLock,
  saveUncommittedWork
} from './Worktrees.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

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

function registeredWorktreesOf(repositoryDirectory: string): string {
  return gitOutputIn(repositoryDirectory, ['worktree', 'list', '--porcelain']);
}

describeWhenGitIsPresent('adding a worktree from a recorded commit', () => {
  test('the worktree sits under the given folder, on the new branch, at the recorded commit rather than the current tip', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-add');
    const recordedCommit = commitFile(repositoryDirectory, 'first.txt', 'one\n');
    commitFile(repositoryDirectory, 'second.txt', 'two\n');
    const worktreesFolder = scratchDirectory('worktrees-add-folder');
    const outcome = addWorktreeFromCommit({
      repositoryDirectory, worktreesFolder, worktreeName: 'job-1', newBranch: 'job/1', startCommit: recordedCommit
    });
    const worktreePath = join(worktreesFolder, 'job-1');
    expect(outcome).toEqual({ verdict: 'added', worktreePath, headCommit: recordedCommit });
    expect(gitOutputIn(worktreePath, ['symbolic-ref', '--short', 'HEAD'])).toBe('job/1');
    expect(gitOutputIn(worktreePath, ['rev-parse', 'HEAD'])).toBe(recordedCommit);
  });

  test('a branch that already exists is refused with git\'s reason, and a commit that does not resolve reads unknown-commit', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-add-refused');
    const tip = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    const worktreesFolder = scratchDirectory('worktrees-add-refused-folder');
    gitOutputIn(repositoryDirectory, ['branch', 'taken']);
    const refusal = addWorktreeFromCommit({
      repositoryDirectory, worktreesFolder, worktreeName: 'one', newBranch: 'taken', startCommit: tip
    });
    expect(refusal.verdict).toBe('refused');
    expect(refusal.verdict === 'refused' ? refusal.reason : '').toContain('taken');
    expect(addWorktreeFromCommit({
      repositoryDirectory, worktreesFolder, worktreeName: 'two', newBranch: 'fresh', startCommit: '--detach'
    }))
      .toEqual({ verdict: 'unknown-commit' });
    expect(existsSync(join(worktreesFolder, 'two'))).toBe(false);
  });
});

describeWhenGitIsPresent('pruning worktree records', () => {
  test('a worktree whose folder vanished is no longer registered after a prune', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-prune');
    const worktreePath = addWorktree(repositoryDirectory, 'vanished');
    rmSync(worktreePath, { recursive: true, force: true });
    expect(registeredWorktreesOf(repositoryDirectory)).toContain(worktreePath);
    expect(pruneWorktrees(repositoryDirectory)).toEqual({ verdict: 'pruned' });
    expect(registeredWorktreesOf(repositoryDirectory)).not.toContain(worktreePath);
  });

  test('outside any repository the prune is refused', () => {
    expect(pruneWorktrees(scratchDirectory('worktrees-prune-no-repository')).verdict).toBe('refused');
  });
});

describeWhenGitIsPresent('removing a stale index.lock', () => {
  test('a linked worktree\'s lock, kept under the main repository, is removed and git can stage again', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-index-lock');
    const worktreePath = addWorktree(repositoryDirectory, 'locked');
    const lockPath = gitOutputIn(worktreePath, ['rev-parse', '--path-format=absolute', '--git-path', 'index.lock']);
    writeFileSync(lockPath, '');
    writeFileSync(join(worktreePath, 'new.txt'), 'new\n');
    expect(Bun.spawnSync(['git', 'add', 'new.txt'], { cwd: worktreePath, stderr: 'pipe' }).exitCode).not.toBe(0);
    const outcome = removeStaleIndexLock(worktreePath);
    expect(outcome.verdict).toBe('removed');
    expect(existsSync(lockPath)).toBe(false);
    gitOutputIn(worktreePath, ['add', 'new.txt']);
  });

  test('a worktree with no lock reads absent, and a folder outside any repository is refused', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-index-lock-absent');
    expect(removeStaleIndexLock(repositoryDirectory).verdict).toBe('absent');
    expect(removeStaleIndexLock(scratchDirectory('worktrees-index-lock-no-repository')).verdict).toBe('refused');
  });
});

describeWhenGitIsPresent('saving uncommitted work to a patch file', () => {
  test('tracked edits and untracked files are saved, ignored files are not, and the patch re-applies on the same commit', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-save');
    commitFile(repositoryDirectory, '.gitignore', 'ignored.log\n');
    commitFile(repositoryDirectory, 'tracked.txt', 'before\n');
    writeFileSync(join(repositoryDirectory, 'tracked.txt'), 'after\n');
    writeFileSync(join(repositoryDirectory, 'untracked.txt'), 'brand new\n');
    writeFileSync(join(repositoryDirectory, 'ignored.log'), 'noise\n');
    const patchPath = join(scratchDirectory('worktrees-save-patch'), 'work.patch');

    expect(saveUncommittedWork(repositoryDirectory, patchPath)).toEqual({ verdict: 'saved', patchPath, untrackedFiles: ['untracked.txt'] });
    const patch = readFileSync(patchPath, 'utf8');
    expect(patch).toContain('+after');
    expect(patch).toContain('+brand new');
    expect(patch).not.toContain('noise');
    expect(readFileSync(join(repositoryDirectory, 'tracked.txt'), 'utf8')).toBe('after\n');

    gitOutputIn(repositoryDirectory, ['reset', '-q', '--hard']);
    rmSync(join(repositoryDirectory, 'untracked.txt'));
    gitOutputIn(repositoryDirectory, ['apply', patchPath]);
    expect(readFileSync(join(repositoryDirectory, 'tracked.txt'), 'utf8')).toBe('after\n');
    expect(readFileSync(join(repositoryDirectory, 'untracked.txt'), 'utf8')).toBe('brand new\n');
  });

  test('a patch path that cannot be written, or a folder outside any repository, is refused', () => {
    const repositoryDirectory = scratchGitRepository('worktrees-save-refused');
    writeFileSync(join(repositoryDirectory, 'untracked.txt'), 'brand new\n');
    const unwritablePath = join(repositoryDirectory, 'untracked.txt', 'work.patch');
    expect(saveUncommittedWork(repositoryDirectory, unwritablePath).verdict).toBe('refused');
    expect(saveUncommittedWork(scratchDirectory('worktrees-save-no-repository'), join(repositoryDirectory, 'work.patch')).verdict).toBe('refused');
  });
});
