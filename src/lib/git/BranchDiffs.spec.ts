/**
 * What a worktree's commits and a rebase changed, as diff text read from real git in scratch repositories. What matters is that every diff
 * carries its own options (a/ and b/ prefixes and 25 lines of context whatever the user's configuration says), that a range holding a merge
 * or a commit off the branch is a verdict rather than a diff, and that each unknown revision names its role. 'git-unavailable' is not tested:
 * it needs a PATH without git, which one process cannot set for its own spawns without changing it for every spec.
 */
import { join } from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import {
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  currentBranchOf,
  gitIsAvailable,
  gitOutputIn,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
} from '../../testing/ScratchWorkspace';
import { readCommitsDiff, readRebaseDiffs, readWorktreeHead } from './BranchDiffs';

const CONTEXT_FILE_LINE_COUNT = 60;

const CONTEXT_FILE_CHANGED_LINE = 30;

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

function headCommitOf(repositoryDirectory: string): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
}

function numberedLines(changedLine: number | null): string {
  const lines: string[] = [];
  for (let i = 1; i <= CONTEXT_FILE_LINE_COUNT; i++) lines.push(i === changedLine ? `changed line ${i}` : `line ${i}`);
  return `${lines.join('\n')}\n`;
}

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('the commit a worktree is at', () => {
  test('a worktree with commits reads its HEAD commit', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-head');
    expect(readWorktreeHead(repositoryDirectory)).toEqual({ verdict: 'read', headCommit: headCommitOf(repositoryDirectory) });
  });

  test('a directory that does not exist is not a repository, and git is never started in it', () => {
    const plainDirectory = scratchDirectory('branch-diffs-missing');
    expect(readWorktreeHead(join(plainDirectory, 'missing'))).toEqual({ verdict: 'not-a-repository' });
  });

  test('a directory outside any repository is not a repository', () => {
    expect(readWorktreeHead(scratchDirectory('branch-diffs-plain'))).toEqual({ verdict: 'not-a-repository' });
  });

  test('a repository with no commit yet reads no-commits', () => {
    const emptyRepository = scratchDirectory('branch-diffs-no-commits');
    gitOutputIn(emptyRepository, ['init', '-q']);
    expect(readWorktreeHead(emptyRepository)).toEqual({ verdict: 'no-commits' });
  });
});

describe.skipIf(!gitIsAvailable())('the commits made since a commit', () => {
  // `diff.noprefix` is the user's configuration a count must not follow: without the prefixes spelled out, every header would change shape.
  test('reads the commits in order and their diff under a/ and b/ prefixes, whatever diff.noprefix says', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-read');
    gitOutputIn(repositoryDirectory, ['config', 'diff.noprefix', 'true']);
    const sinceCommit  = headCommitOf(repositoryDirectory);
    const firstCommit  = commitFile(repositoryDirectory, 'notes.txt', 'first added line\n');
    const secondCommit = commitFile(repositoryDirectory, 'notes.txt', 'first added line\nsecond added line\n');

    const reading = readCommitsDiff(repositoryDirectory, sinceCommit);
    expect(reading.verdict).toBe('read');
    if (reading.verdict !== 'read') return;
    expect(reading.sinceCommit).toBe(sinceCommit);
    expect(reading.commits).toEqual([firstCommit, secondCommit]);
    expect(reading.diffText).toContain('diff --git a/notes.txt b/notes.txt');
    expect(reading.diffText).toContain('+first added line');
    expect(reading.diffText).toContain('+second added line');
  });

  test('shows 25 lines of context around a change, not git\'s default 3', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-context');
    const sinceCommit         = commitFile(repositoryDirectory, 'numbers.txt', numberedLines(null));
    commitFile(repositoryDirectory, 'numbers.txt', numberedLines(CONTEXT_FILE_CHANGED_LINE));

    const reading = readCommitsDiff(repositoryDirectory, sinceCommit);
    expect(reading.verdict).toBe('read');
    if (reading.verdict !== 'read') return;
    expect(reading.diffText).toContain('\n line 5\n');
    expect(reading.diffText).toContain('\n line 55\n');
    expect(reading.diffText).not.toContain('\n line 4\n');
    expect(reading.diffText).not.toContain('\n line 56\n');
  });

  test('a revision that names no commit reads unknown-commit', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-unknown');
    expect(readCommitsDiff(repositoryDirectory, 'no-such-revision')).toEqual({ verdict: 'unknown-commit' });
  });

  test('a commit on another branch is not an ancestor of HEAD, and says which commit it resolved to', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-not-ancestor');
    const mainLine            = currentBranchOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'side']);
    const sideCommit = commitFile(repositoryDirectory, 'side.txt', 'side\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    commitFile(repositoryDirectory, 'main.txt', 'main\n');

    expect(readCommitsDiff(repositoryDirectory, sideCommit)).toEqual({ verdict: 'not-an-ancestor', sinceCommit: sideCommit });
  });

  // A merge in the range would count the main line's commits as the branch's own, so the range is refused rather than read.
  test('a range holding a merge commit reads merge-found with that merge', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-merge');
    const mainLine            = currentBranchOf(repositoryDirectory);
    const sinceCommit         = headCommitOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'side']);
    commitFile(repositoryDirectory, 'side.txt', 'side\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    commitFile(repositoryDirectory, 'main.txt', 'main\n');
    gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side']);

    expect(readCommitsDiff(repositoryDirectory, sinceCommit)).toEqual({ verdict: 'merge-found', mergeCommits: [headCommitOf(repositoryDirectory)] });
  });
});

describe.skipIf(!gitIsAvailable())('what a rebase changed in a branch\'s own work', () => {
  test('reads the old and new bases and both net patches after a real rebase', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-rebase');
    const mainLine            = currentBranchOf(repositoryDirectory);
    const oldBaseCommit       = headCommitOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'feature']);
    const oldTipCommit = commitFile(repositoryDirectory, 'feature.txt', 'feature line\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    const newBaseCommit = commitFile(repositoryDirectory, 'main.txt', 'main line\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'feature']);
    gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'rebase', '-q', mainLine]);
    const rebasedTipCommit = headCommitOf(repositoryDirectory);

    const reading = readRebaseDiffs(repositoryDirectory, oldTipCommit, mainLine, rebasedTipCommit);
    expect(reading.verdict).toBe('read');
    if (reading.verdict !== 'read') return;
    expect(reading.oldTipCommit).toBe(oldTipCommit);
    expect(reading.oldBaseCommit).toBe(oldBaseCommit);
    expect(reading.newBaseCommit).toBe(newBaseCommit);
    expect(reading.beforeDiffText).toContain('+feature line');
    expect(reading.afterDiffText).toContain('+feature line');
  });

  test('an old tip that names no commit reads unknown-commit in the old-tip role', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-unknown-old-tip');
    const headCommit          = headCommitOf(repositoryDirectory);
    expect(readRebaseDiffs(repositoryDirectory, 'no-such-revision', currentBranchOf(repositoryDirectory), headCommit))
      .toEqual({ verdict: 'unknown-commit', role: 'old-tip' });
  });

  test('a main line that names no commit reads unknown-commit in the main-line role', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-unknown-main-line');
    const headCommit          = headCommitOf(repositoryDirectory);
    expect(readRebaseDiffs(repositoryDirectory, headCommit, 'no-such-main-line', headCommit)).toEqual({ verdict: 'unknown-commit', role: 'main-line' });
  });

  test('an old tip sharing no history with the main line reads no-common-base in the old-tip role', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-orphan');
    const mainLine            = currentBranchOf(repositoryDirectory);
    const mainLineCommit      = headCommitOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '--orphan', 'orphan']);
    const orphanCommit = commitFile(repositoryDirectory, 'orphan.txt', 'orphan\n');

    expect(readRebaseDiffs(repositoryDirectory, orphanCommit, mainLine, mainLineCommit)).toEqual({ verdict: 'no-common-base', role: 'old-tip' });
  });
});
