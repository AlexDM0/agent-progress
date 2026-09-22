/**
 * The git half of `agent-progress rework`: which commits a review made, and what a rebase changed in a
 * branch's own work, as diff text for `lib/utils/ReworkCountUtil.ts` to count. Every diff is asked for with
 * its options spelled out, so a reviewer's own git configuration cannot make two reviewers count differently.
 */
import { existsSync, statSync } from 'node:fs';

const GIT_SUCCESS_EXIT_CODE = 0;

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

const CONFIGURATION_OVERRIDES = ['-c', 'core.quotePath=false'];

interface GitRun {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

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

/** `null` when git could not be started at all. */
function runGit(directory: string, gitArguments: readonly string[]): GitRun | null {
  try {
    const finished = Bun.spawnSync({
      cmd:    ['git', ...CONFIGURATION_OVERRIDES, ...gitArguments],
      cwd:    directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode:       finished.exitCode,
      standardOutput: finished.stdout.toString(),
      standardError:  finished.stderr.toString().trim(),
    };
  } catch {
    return null;
  }
}

function failureReasonOf(run: GitRun | null, gitArguments: readonly string[]): string {
  const command = `git ${gitArguments.join(' ')}`;
  if (run === null) return `${command} could not be started.`;
  return `${command} exited with ${run.exitCode}: ${run.standardError}`;
}

/** `--end-of-options`, so a revision written as `--output=x` is looked up rather than obeyed. */
function resolvedCommit(directory: string, revision: string): string | null {
  const run = runGit(directory, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`]);
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return null;
  return run.standardOutput.trim();
}

function linesOf(output: string): string[] {
  return output.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

/** Fail closed: a `stat` that errors reads as "not a directory", which is refused rather than handed to git as a working directory. */
function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function readWorktreeHead(directory: string): WorktreeHeadReading {
  if (!directoryExists(directory)) return { verdict: 'not-a-repository' };
  const insideWorkTree = runGit(directory, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree === null) return { verdict: 'git-unavailable' };
  if (insideWorkTree.exitCode !== GIT_SUCCESS_EXIT_CODE || insideWorkTree.standardOutput.trim() !== 'true') return { verdict: 'not-a-repository' };
  const headCommit = resolvedCommit(directory, 'HEAD');
  return headCommit === null ? { verdict: 'no-commits' } : { verdict: 'read', headCommit };
}

/** Every commit in `<since>..HEAD`. A merge among them is a verdict of its own: work is rebased, and a merge would count the main line's commits. */
export function readCommitsDiff(directory: string, since: string): CommitsDiffReading {
  const sinceCommit = resolvedCommit(directory, since);
  if (sinceCommit === null) return { verdict: 'unknown-commit' };

  const ancestryArguments = ['merge-base', '--is-ancestor', sinceCommit, 'HEAD'];
  const ancestry          = runGit(directory, ancestryArguments);
  if (ancestry === null || (ancestry.exitCode !== GIT_SUCCESS_EXIT_CODE && ancestry.exitCode !== MERGE_BASE_NOT_FOUND_EXIT_CODE)) {
    return { verdict: 'git-failed', reason: failureReasonOf(ancestry, ancestryArguments) };
  }
  if (ancestry.exitCode === MERGE_BASE_NOT_FOUND_EXIT_CODE) return { verdict: 'not-an-ancestor', sinceCommit };

  const range           = `${sinceCommit}..HEAD`;
  const mergesArguments = ['rev-list', '--merges', range];
  const merges          = runGit(directory, mergesArguments);
  if (merges === null || merges.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'git-failed', reason: failureReasonOf(merges, mergesArguments) };
  const mergeCommits = linesOf(merges.standardOutput);
  if (mergeCommits.length > 0) return { verdict: 'merge-found', mergeCommits };

  const commitsArguments = ['rev-list', '--reverse', range];
  const commits          = runGit(directory, commitsArguments);
  if (commits === null || commits.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'git-failed', reason: failureReasonOf(commits, commitsArguments) };

  const logArguments = ['log', '--patch', '--format=', '--no-show-signature', ...DIFF_OPTIONS, range];
  const log          = runGit(directory, logArguments);
  if (log === null || log.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'git-failed', reason: failureReasonOf(log, logArguments) };

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
  const run                = runGit(directory, mergeBaseArguments);
  if (run !== null && run.exitCode === MERGE_BASE_NOT_FOUND_EXIT_CODE && run.standardError === '') return { verdict: 'none' };
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'git-failed', reason: failureReasonOf(run, mergeBaseArguments) };
  return { verdict: 'found', base: run.standardOutput.trim() };
}

function diffBetween(directory: string, fromCommit: string, toCommit: string): { verdict: 'read'; diffText: string } | { verdict: 'git-failed'; reason: string } {
  const diffArguments = ['diff', ...DIFF_OPTIONS, fromCommit, toCommit];
  const run           = runGit(directory, diffArguments);
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'git-failed', reason: failureReasonOf(run, diffArguments) };
  return { verdict: 'read', diffText: run.standardOutput };
}

/**
 * The branch's net patch against the main line before the rebase and after it: `merge-base(old tip, main)..old tip`
 * and `merge-base(rebased tip, main)..rebased tip`. What differs between the two is what the rebase changed in the
 * branch's own work. The rebased tip is a resolved commit the caller chose, so commits made after the rebase stay out.
 */
export function readRebaseDiffs(directory: string, oldTip: string, mainLine: string, rebasedTipCommit: string): RebaseDiffsReading {
  const oldTipCommit = resolvedCommit(directory, oldTip);
  if (oldTipCommit === null) return { verdict: 'unknown-commit', role: 'old-tip' };
  const mainLineCommit = resolvedCommit(directory, mainLine);
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
