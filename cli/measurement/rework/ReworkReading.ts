/** The git reads `rework` counts from: the worktree's head, the commits since a review started, and what a rebase changed. */
import { readCommitsDiff, readRebaseDiffs, readWorktreeHead } from '../../../src/lib/git/BranchDiffs.ts';
import { OperationRefusal }                                   from '../../../src/shared/OperationRefusal.ts';
import { OutputUtil }                                         from '../../utils/OutputUtil.ts';
import { ReworkCountUtil }                                    from '../utils/ReworkCountUtil.ts';
import type { FileRework }                                    from '../utils/ReworkCountUtil.ts';

export interface CommitsPart {
  sinceCommit: string;
  commitCount: number;
  files:       FileRework[];
}

export interface RebasePart {
  oldTipCommit:     string;
  rebasedTipCommit: string;
  mainLine:         string;
  oldBaseCommit:    string;
  newBaseCommit:    string;
  files:            FileRework[];
}

export function countCommits(worktreeDirectory: string, since: string): CommitsPart {
  const reading = readCommitsDiff(worktreeDirectory, since);
  switch (reading.verdict) {
    case 'unknown-commit':
      throw new OperationRefusal('refused', `--since "${since}" does not name a commit in ${worktreeDirectory}.`);
    case 'not-an-ancestor':
      throw new OperationRefusal(
        'refused',
        `--since ${OutputUtil.shortCommitOf(reading.sinceCommit)} is not an ancestor of HEAD in ${worktreeDirectory}, so there is no line of commits since it to count. `
          + 'A rebase rewrites the commits after it: count --since before rebasing, and the rebase itself with --rebased-from ORIG_HEAD after.',
      );
    case 'merge-found': {
      const mergeWord         = reading.mergeCommits.length === 1 ? 'merge' : 'merges';
      const shortMergeCommits = reading.mergeCommits.map((commit) => OutputUtil.shortCommitOf(commit)).join(', ');
      throw new OperationRefusal(
        'refused',
        `The commits since ${OutputUtil.shortCommitOf(since)} include the ${mergeWord} ${shortMergeCommits}. `
          + 'Work is rebased onto the main line rather than merged with it, and a merge would bring the main line\'s own commits into the count: '
          + 'rebase the branch, or name a --since after the merge.',
      );
    }
    case 'git-failed':
      throw new OperationRefusal('unrepaired', reading.reason);
    case 'read':
      break;
  }
  return {
    sinceCommit: reading.sinceCommit,
    commitCount: reading.commits.length,
    files:       ReworkCountUtil.combineFileReworks([ReworkCountUtil.readDiff(reading.diffText).map((file) => ReworkCountUtil.reworkOfFile(file))]),
  };
}

/** With --since as well, the rebase is measured up to the review's start: the commits after it are the review's, and are counted there once. */
export function countRebase(worktreeDirectory: string, oldTip: string, mainLine: string, rebasedTipCommit: string): RebasePart {
  const reading = readRebaseDiffs(worktreeDirectory, oldTip, mainLine, rebasedTipCommit);
  switch (reading.verdict) {
    case 'unknown-commit':
      throw new OperationRefusal(
        'refused',
        reading.role === 'old-tip'
          ? `--rebased-from "${oldTip}" does not name a commit in ${worktreeDirectory}.`
          : `--main "${mainLine}" does not name a commit in ${worktreeDirectory}: name the branch the work was rebased onto with --main.`,
      );
    case 'no-common-base':
      throw new OperationRefusal(
        'refused',
        `${reading.role === 'old-tip' ? `--rebased-from "${oldTip}"` : OutputUtil.shortCommitOf(rebasedTipCommit)} shares no history with --main "${mainLine}", `
          + 'so there is no patch of the branch\'s own to compare.',
      );
    case 'git-failed':
      throw new OperationRefusal('unrepaired', reading.reason);
    case 'read':
      break;
  }
  const changedByTheRebase = ReworkCountUtil.addedLinesInOnlyOne(ReworkCountUtil.readDiff(reading.beforeDiffText), ReworkCountUtil.readDiff(reading.afterDiffText));
  return {
    oldTipCommit:  reading.oldTipCommit,
    rebasedTipCommit,
    mainLine,
    oldBaseCommit: reading.oldBaseCommit,
    newBaseCommit: reading.newBaseCommit,
    files:         ReworkCountUtil.combineFileReworks([changedByTheRebase.map((file) => ReworkCountUtil.reworkOfFile(file))]),
  };
}

export function worktreeHeadCommit(worktreeDirectory: string): string {
  const reading = readWorktreeHead(worktreeDirectory);
  switch (reading.verdict) {
    case 'not-a-repository':
      throw new OperationRefusal('refused', `${worktreeDirectory} is not inside a git working tree. Run this in the worktree under review, or name it with --worktree.`);
    case 'no-commits':
      throw new OperationRefusal('refused', `${worktreeDirectory} has no commits yet, so nothing has been reworked.`);
    case 'git-unavailable':
      throw new OperationRefusal('unrepaired', 'git could not be started, and rework is counted from git\'s history.');
    case 'read':
      return reading.headCommit;
  }
}
