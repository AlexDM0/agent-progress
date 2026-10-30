/**
 * Every diff carries its own options whatever the user's configuration says, and a range holding a merge or an unknown revision is a
 * verdict of its own.
 */
import { afterAll, expect, test } from 'bun:test';

import {
  commitFile,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                 from '../../testing/ToolGuard.ts';
import { readCommitsDiff, readMergeResolutionDiff } from './BranchDiffs.ts';

const CONTEXT_FILE_LINE_COUNT = 60;

const CONTEXT_FILE_CHANGED_LINE = 30;

const scratchDirectories: string[] = [];

function scratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
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

describeWhenGitIsPresent('the commits made since a commit', () => {
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

describeWhenGitIsPresent('what a merge\'s resolution changed against git\'s automatic merge', () => {
  function divergedRepository(prefix: string, sideFile: string, sideContent: string): string {
    const repositoryDirectory = scratchGitRepository(prefix);
    const mainLine            = currentBranchOf(repositoryDirectory);
    commitFile(repositoryDirectory, 'shared.txt', 'base\n');
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'side']);
    commitFile(repositoryDirectory, sideFile, sideContent);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', mainLine]);
    commitFile(repositoryDirectory, 'shared.txt', 'main\n');
    return repositoryDirectory;
  }

  test('a merge git made by itself reads an empty diff, not conflicted', () => {
    const repositoryDirectory = divergedRepository('branch-diffs-clean-merge', 'side-only.txt', 'side only\n');
    gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side']);

    const reading = readMergeResolutionDiff(repositoryDirectory, 'HEAD');
    expect(reading).toMatchObject({
      verdict: 'read', mergeCommit: headCommitOf(repositoryDirectory), automaticMergeConflicted: false, diffText: ''
    });
  });

  // The diff runs from git's conflicted tree, markers in it, to the tree the merge committed, whatever merge.conflictStyle says.
  test('a conflicted merge reads the diff from the conflict markers to the resolution, in the plain two-sided marker style', () => {
    const repositoryDirectory = divergedRepository('branch-diffs-conflicted-merge', 'shared.txt', 'side\n');
    gitOutputIn(repositoryDirectory, ['config', 'merge.conflictStyle', 'diff3']);
    const mergeRun = Bun.spawnSync(['git', ...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'merge', '-q', 'side'], { cwd: repositoryDirectory, stdout: 'pipe', stderr: 'pipe' });
    expect(mergeRun.exitCode, 'the merge stops on the conflict it was built to have').not.toBe(0);
    commitFile(repositoryDirectory, 'shared.txt', 'settled\n');

    const reading = readMergeResolutionDiff(repositoryDirectory, 'HEAD');
    expect(reading.verdict).toBe('read');
    if (reading.verdict !== 'read') return;
    expect(reading.automaticMergeConflicted).toBe(true);
    expect(reading.diffText).toContain('-<<<<<<< ');
    expect(reading.diffText).not.toContain('-||||||| ');
    expect(reading.diffText).toContain('+settled');
  });

  test('a commit with one parent reads not-a-two-parent-merge with its parent count', () => {
    const repositoryDirectory = scratchGitRepository('branch-diffs-not-a-merge');
    const commit              = commitFile(repositoryDirectory, 'plain.txt', 'plain\n');
    expect(readMergeResolutionDiff(repositoryDirectory, commit)).toEqual({ verdict: 'not-a-two-parent-merge', mergeCommit: commit, parentCount: 1 });
  });

  test('a revision that names no commit reads unknown-commit', () => {
    expect(readMergeResolutionDiff(scratchGitRepository('branch-diffs-unknown-merge'), 'no-such-merge')).toEqual({ verdict: 'unknown-commit' });
  });
});
