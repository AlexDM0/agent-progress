/**
 * Which commits a review made, and what a rebase changed in a branch's own work, as diff text for a caller to count. Every diff is asked
 * for with its options spelled out, so a reviewer's own git configuration cannot make two reviewers count differently.
 */
import { GitProcess } from './GitProcess';

const MERGE_BASE_NOT_FOUND_EXIT_CODE = 1;

/**
 * More context than git's default three lines, so a hunk that begins inside a long comment usually carries
 * the comment's delimiter with it. Context never changes which lines are added or removed, only how they are read.
 */
const REWORK_DIFF_CONTEXT_LINES = 25;

const DIFF_OPTIONS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '--submodule=short',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--find-renames',
  '--diff-algorithm=myers',
  '--indent-heuristic',
  `--unified=${REWORK_DIFF_CONTEXT_LINES}`,
];

export type WorktreeHeadReading =
  | { verdict: 'read'; headCommit: string }
  | { verdict: 'not-a-repository' }
  | { verdict: 'no-commits' }
  | { verdict: 'git-unavailable' };

export type CommitsDiffReading =
  | { verdict: 'read'; sinceCommit: string; commits: string[]; diffText: string }
  | { verdict: 'unknown-commit' }
  | { verdict: 'not-an-ancestor'; sinceCommit: string }
  | { verdict: 'merge-found'; mergeCommits: string[] }
  | { verdict: 'git-failed'; reason: string };

export type RebaseDiffsReading =
  | { verdict: 'read'; oldTipCommit: string; oldBaseCommit: string; newBaseCommit: string; beforeDiffText: string; afterDiffText: string }
  | { verdict: 'unknown-commit'; role: 'old-tip' | 'main-line' }
  | { verdict: 'no-common-base'; role: 'old-tip' | 'rebased-tip' }
  | { verdict: 'git-failed'; reason: string };

function linesOf(output: string): string[] {
  return output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

export function readWorktreeHead(directory: string): WorktreeHeadReading {
  if (!GitProcess.directoryExists(directory)) return { verdict: 'not-a-repository' };
  const insideWorkTree = GitProcess.run(directory, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree === null) return { verdict: 'git-unavailable' };
  if (!GitProcess.succeeded(insideWorkTree) || insideWorkTree.standardOutput.trim() !== 'true') return { verdict: 'not-a-repository' };
  const headCommit = GitProcess.resolvedCommitOf(directory, 'HEAD');
  return headCommit === null ? { verdict: 'no-commits' } : { verdict: 'read', headCommit };
}

/** Every commit in `<since>..HEAD`. A merge among them is a verdict of its own: work is rebased, and a merge would count the main line's commits. */
export function readCommitsDiff(directory: string, since: string): CommitsDiffReading {
  const sinceCommit = GitProcess.resolvedCommitOf(directory, since);
  if (sinceCommit === null) return { verdict: 'unknown-commit' };

  const ancestryArguments = ['merge-base', '--is-ancestor', sinceCommit, 'HEAD'];
  const ancestry          = GitProcess.run(directory, ancestryArguments);
  if (ancestry === null || (!GitProcess.succeeded(ancestry) && ancestry.exitCode !== MERGE_BASE_NOT_FOUND_EXIT_CODE)) {
    return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(ancestry, ancestryArguments) };
  }
  if (ancestry.exitCode === MERGE_BASE_NOT_FOUND_EXIT_CODE) return { verdict: 'not-an-ancestor', sinceCommit };

  const range           = `${sinceCommit}..HEAD`;
  const mergesArguments = ['rev-list', '--merges', range];
  const merges          = GitProcess.run(directory, mergesArguments);
  if (!GitProcess.succeeded(merges)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(merges, mergesArguments) };
  const mergeCommits = linesOf(merges.standardOutput);
  if (mergeCommits.length > 0) return { verdict: 'merge-found', mergeCommits };

  const commitsArguments = ['rev-list', '--reverse', range];
  const commits          = GitProcess.run(directory, commitsArguments);
  if (!GitProcess.succeeded(commits)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(commits, commitsArguments) };

  const logArguments = ['log', '--patch', '--format=', '--no-show-signature', ...DIFF_OPTIONS, range];
  const log          = GitProcess.run(directory, logArguments);
  if (!GitProcess.succeeded(log)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(log, logArguments) };

  return {
    verdict:  'read',
    sinceCommit,
    commits:  linesOf(commits.standardOutput),
    diffText: log.standardOutput,
  };
}

type MergeBaseReading = { verdict: 'found'; base: string } | { verdict: 'none' } | { verdict: 'git-failed'; reason: string };

function mergeBaseOf(directory: string, commit: string, mainLineCommit: string): MergeBaseReading {
  const mergeBaseArguments = ['merge-base', commit, mainLineCommit];
  const run                = GitProcess.run(directory, mergeBaseArguments);
  if (run !== null && run.exitCode === MERGE_BASE_NOT_FOUND_EXIT_CODE && run.standardError === '') return { verdict: 'none' };
  if (!GitProcess.succeeded(run)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(run, mergeBaseArguments) };
  return { verdict: 'found', base: run.standardOutput.trim() };
}

function diffBetween(directory: string, fromCommit: string, toCommit: string): { verdict: 'read'; diffText: string } | { verdict: 'git-failed'; reason: string } {
  const diffArguments = ['diff', ...DIFF_OPTIONS, fromCommit, toCommit];
  const run           = GitProcess.run(directory, diffArguments);
  if (!GitProcess.succeeded(run)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(run, diffArguments) };
  return { verdict: 'read', diffText: run.standardOutput };
}

/**
 * The branch's net patch against the main line before the rebase and after it: `merge-base(old tip, main)..old tip`
 * and `merge-base(rebased tip, main)..rebased tip`. What differs between the two is what the rebase changed in the
 * branch's own work. The rebased tip is a resolved commit the caller chose, so commits made after the rebase stay out.
 */
export function readRebaseDiffs(directory: string, oldTip: string, mainLine: string, rebasedTipCommit: string): RebaseDiffsReading {
  const oldTipCommit = GitProcess.resolvedCommitOf(directory, oldTip);
  if (oldTipCommit === null) return { verdict: 'unknown-commit', role: 'old-tip' };
  const mainLineCommit = GitProcess.resolvedCommitOf(directory, mainLine);
  if (mainLineCommit === null) return { verdict: 'unknown-commit', role: 'main-line' };

  const oldBase = mergeBaseOf(directory, oldTipCommit, mainLineCommit);
  if (oldBase.verdict === 'none') return { verdict: 'no-common-base', role: 'old-tip' };
  if (oldBase.verdict === 'git-failed') return oldBase;
  const newBase = mergeBaseOf(directory, rebasedTipCommit, mainLineCommit);
  if (newBase.verdict === 'none') return { verdict: 'no-common-base', role: 'rebased-tip' };
  if (newBase.verdict === 'git-failed') return newBase;

  const before = diffBetween(directory, oldBase.base, oldTipCommit);
  if (before.verdict === 'git-failed') return before;
  const after = diffBetween(directory, newBase.base, rebasedTipCommit);
  if (after.verdict === 'git-failed') return after;

  return {
    verdict:        'read',
    oldTipCommit,
    oldBaseCommit:  oldBase.base,
    newBaseCommit:  newBase.base,
    beforeDiffText: before.diffText,
    afterDiffText:  after.diffText,
  };
}
