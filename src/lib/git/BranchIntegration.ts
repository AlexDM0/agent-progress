/**
 * The git steps of bringing a branch into the main checkout, as verdicts: which branch the main checkout is on, whether a branch descends
 * from the main line, the fast-forward itself, and the two cleanups. Nothing here forces anything: a refusal git gives is handed back with its reason.
 */
import { GitProcess }                from './GitProcess.ts';
import { NOT_AN_ANCESTOR_EXIT_CODE } from './constants/GitConventions.ts';

const DETACHED_HEAD_EXIT_CODE = 1;

const PORCELAIN_STATUS_PREFIX_CHARACTERS = 3;

const UNTRACKED_STATUS_CODE = '??';

const RENAME_OR_COPY_STATUS_CODES = ['R', 'C'] as const;

export type CurrentBranchReading =
  | { verdict: 'on-branch'; branch: string }
  | { verdict: 'detached' }
  | { verdict: 'git-failed'; reason: string };

export type BranchDescentReading =
  | { verdict: 'descendant'; branchCommit: string; mainLineCommit: string }
  | { verdict: 'not-a-descendant'; branchCommit: string; mainLineCommit: string }
  | { verdict: 'unknown-branch' }
  | { verdict: 'unknown-main-line' }
  | { verdict: 'git-failed'; reason: string };

export type FastForwardOutcome =
  | { verdict: 'fast-forwarded'; commit: string }
  | { verdict: 'refused'; reason: string; blockingFiles: string[] };

export interface FilesLeftInWorktree {
  untrackedFiles: string[];
  changedFiles:   string[];
}

export type WorktreeRemovalOutcome =
  | { verdict: 'removed' }
  | { verdict: 'left'; reason: string; filesLeft: FilesLeftInWorktree };

export type BranchDeletionOutcome =
  | { verdict: 'deleted' }
  | { verdict: 'left'; reason: string };

export function readCurrentBranch(directory: string): CurrentBranchReading {
  const branchArguments = ['symbolic-ref', '--quiet', '--short', 'HEAD'];
  const run             = GitProcess.run(directory, branchArguments);
  if (run !== null && run.exitCode === DETACHED_HEAD_EXIT_CODE && run.standardError === '') return { verdict: 'detached' };
  if (!GitProcess.succeeded(run)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(run, branchArguments) };
  return { verdict: 'on-branch', branch: run.standardOutput.trim() };
}

/** Both names are looked up as local branches only, so the branch that was checked is the one a later branch deletion can delete. */
export function readBranchDescent(directory: string, branch: string, mainLine: string): BranchDescentReading {
  const branchCommit = GitProcess.resolvedCommitOf(directory, `refs/heads/${branch}`);
  if (branchCommit === null) return { verdict: 'unknown-branch' };
  const mainLineCommit = GitProcess.resolvedCommitOf(directory, `refs/heads/${mainLine}`);
  if (mainLineCommit === null) return { verdict: 'unknown-main-line' };

  const ancestryArguments = ['merge-base', '--is-ancestor', mainLineCommit, branchCommit];
  const ancestry          = GitProcess.run(directory, ancestryArguments);
  if (GitProcess.succeeded(ancestry)) return { verdict: 'descendant', branchCommit, mainLineCommit };
  if (ancestry !== null && ancestry.exitCode === NOT_AN_ANCESTOR_EXIT_CODE) return { verdict: 'not-a-descendant', branchCommit, mainLineCommit };
  return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(ancestry, ancestryArguments) };
}

function nulSeparatedFieldsOf(output: string): string[] {
  return output.split('\0').filter((field) => field !== '');
}

// `-z` leaves paths unquoted; a rename or copy entry is followed by a field of its own holding the path it came from.
function uncommittedPathsIn(directory: string): Set<string> {
  const run = GitProcess.run(directory, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const uncommittedPaths = new Set<string>();
  if (!GitProcess.succeeded(run)) return uncommittedPaths;
  const fields = nulSeparatedFieldsOf(run.standardOutput);
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] ?? '';
    uncommittedPaths.add(entry.slice(PORCELAIN_STATUS_PREFIX_CHARACTERS));
    if (RENAME_OR_COPY_STATUS_CODES.some((statusCode) => entry.startsWith(statusCode))) uncommittedPaths.add(fields[++i] ?? '');
  }
  return uncommittedPaths;
}

function pathsChangedBetween(directory: string, commit: string): string[] {
  const run = GitProcess.run(directory, ['diff', '--name-only', '--no-renames', '-z', 'HEAD', commit, '--']);
  return GitProcess.succeeded(run) ? nulSeparatedFieldsOf(run.standardOutput) : [];
}

/** The uncommitted paths, tracked or not, that the fast-forward would write over: what stops git, named so a person can commit or stash them. */
function blockingFilesOf(directory: string, commit: string): string[] {
  const uncommittedPaths = uncommittedPathsIn(directory);
  return pathsChangedBetween(directory, commit).filter((path) => uncommittedPaths.has(path));
}

/** Merges the commit that was checked, not the branch name, so a commit made to the branch after the check is not merged unseen. */
export function fastForwardTo(directory: string, commit: string): FastForwardOutcome {
  const mergeArguments = ['merge', '--ff-only', '--quiet', commit];
  const run            = GitProcess.run(directory, mergeArguments);
  if (!GitProcess.succeeded(run)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(run, mergeArguments), blockingFiles: blockingFilesOf(directory, commit) };
  const headCommit = GitProcess.resolvedCommitOf(directory, 'HEAD');
  if (headCommit !== commit) return { verdict: 'refused', reason: `git merge --ff-only ${commit} exited 0, yet HEAD is ${headCommit ?? 'unreadable'}.`, blockingFiles: [] };
  return { verdict: 'fast-forwarded', commit };
}

function filesLeftIn(worktreePath: string): FilesLeftInWorktree {
  const filesLeft: FilesLeftInWorktree = { untrackedFiles: [], changedFiles: [] };
  if (!GitProcess.directoryExists(worktreePath)) return filesLeft;
  const run = GitProcess.run(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!GitProcess.succeeded(run)) return filesLeft;
  for (const line of run.standardOutput.split('\n')) {
    if (line.length <= PORCELAIN_STATUS_PREFIX_CHARACTERS) continue;
    const path = line.slice(PORCELAIN_STATUS_PREFIX_CHARACTERS);
    if (line.startsWith(UNTRACKED_STATUS_CODE)) filesLeft.untrackedFiles.push(path);
    else filesLeft.changedFiles.push(path);
  }
  return filesLeft;
}

/** Never `--force`: a worktree holding files git would lose is left standing, and what it holds is named so a person can decide. */
export function removeWorktree(mainCheckoutDirectory: string, worktreePath: string): WorktreeRemovalOutcome {
  const removalArguments = ['worktree', 'remove', worktreePath];
  const run              = GitProcess.run(mainCheckoutDirectory, removalArguments);
  if (GitProcess.succeeded(run)) return { verdict: 'removed' };
  return { verdict: 'left', reason: GitProcess.failureReasonOf(run, removalArguments), filesLeft: filesLeftIn(worktreePath) };
}

/** `-d`, never `-D`: git deletes only a branch the main checkout's HEAD already holds. */
export function deleteMergedBranch(mainCheckoutDirectory: string, branch: string): BranchDeletionOutcome {
  const deletionArguments = ['branch', '-d', branch];
  const run               = GitProcess.run(mainCheckoutDirectory, deletionArguments);
  if (GitProcess.succeeded(run)) return { verdict: 'deleted' };
  return { verdict: 'left', reason: GitProcess.failureReasonOf(run, deletionArguments) };
}
