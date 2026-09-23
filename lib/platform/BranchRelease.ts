/**
 * The git half of `agent-progress release`, as verdicts: which branch the main checkout is on, whether a branch descends from the main
 * line, the fast-forward itself, and the two cleanups. Nothing here forces anything: a refusal git gives is handed back with its reason.
 */
import { existsSync, statSync } from 'node:fs';

const GIT_SUCCESS_EXIT_CODE = 0;

const NOT_AN_ANCESTOR_EXIT_CODE = 1;

const DETACHED_HEAD_EXIT_CODE = 1;

const CONFIGURATION_OVERRIDES = ['-c', 'core.quotePath=false'];

const PORCELAIN_STATUS_WIDTH = 3;

const UNTRACKED_STATUS_CODE = '??';

interface GitRun {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

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
  | { verdict: 'refused'; reason: string };

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

/** Fail closed: a `stat` that errors reads as "not a directory", which git is never started in. */
function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `--end-of-options`, so a revision written as `--output=x` is looked up rather than obeyed. */
function resolvedCommit(directory: string, revision: string): string | null {
  const run = runGit(directory, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`]);
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return null;
  return run.standardOutput.trim();
}

export function readCurrentBranch(directory: string): CurrentBranchReading {
  const branchArguments = ['symbolic-ref', '--quiet', '--short', 'HEAD'];
  const run             = runGit(directory, branchArguments);
  if (run !== null && run.exitCode === DETACHED_HEAD_EXIT_CODE && run.standardError === '') return { verdict: 'detached' };
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'git-failed', reason: failureReasonOf(run, branchArguments) };
  return { verdict: 'on-branch', branch: run.standardOutput.trim() };
}

/** Both names are looked up as local branches only: a release deletes the branch afterwards, which a remote-tracking ref cannot be. */
export function readBranchDescent(directory: string, branch: string, mainLine: string): BranchDescentReading {
  const branchCommit = resolvedCommit(directory, `refs/heads/${branch}`);
  if (branchCommit === null) return { verdict: 'unknown-branch' };
  const mainLineCommit = resolvedCommit(directory, `refs/heads/${mainLine}`);
  if (mainLineCommit === null) return { verdict: 'unknown-main-line' };

  const ancestryArguments = ['merge-base', '--is-ancestor', mainLineCommit, branchCommit];
  const ancestry          = runGit(directory, ancestryArguments);
  if (ancestry !== null && ancestry.exitCode === GIT_SUCCESS_EXIT_CODE) return { verdict: 'descendant', branchCommit, mainLineCommit };
  if (ancestry !== null && ancestry.exitCode === NOT_AN_ANCESTOR_EXIT_CODE) return { verdict: 'not-a-descendant', branchCommit, mainLineCommit };
  return { verdict: 'git-failed', reason: failureReasonOf(ancestry, ancestryArguments) };
}

/** Merges the commit that was checked, not the branch name, so a commit made to the branch after the check is not released unseen. */
export function fastForwardTo(directory: string, commit: string): FastForwardOutcome {
  const mergeArguments = ['merge', '--ff-only', '--quiet', commit];
  const run            = runGit(directory, mergeArguments);
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return { verdict: 'refused', reason: failureReasonOf(run, mergeArguments) };
  const headCommit = resolvedCommit(directory, 'HEAD');
  if (headCommit !== commit) return { verdict: 'refused', reason: `git merge --ff-only ${commit} exited 0, yet HEAD is ${headCommit ?? 'unreadable'}.` };
  return { verdict: 'fast-forwarded', commit };
}

function filesLeftIn(worktreePath: string): FilesLeftInWorktree {
  const filesLeft: FilesLeftInWorktree = { untrackedFiles: [], changedFiles: [] };
  if (!directoryExists(worktreePath)) return filesLeft;
  const run = runGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (run === null || run.exitCode !== GIT_SUCCESS_EXIT_CODE) return filesLeft;
  for (const line of run.standardOutput.split('\n')) {
    if (line.length <= PORCELAIN_STATUS_WIDTH) continue;
    const path = line.slice(PORCELAIN_STATUS_WIDTH);
    if (line.startsWith(UNTRACKED_STATUS_CODE)) filesLeft.untrackedFiles.push(path);
    else filesLeft.changedFiles.push(path);
  }
  return filesLeft;
}

/** Never `--force`: a worktree holding files git would lose is left standing, and what it holds is named so a person can decide. */
export function removeWorktree(mainCheckoutDirectory: string, worktreePath: string): WorktreeRemovalOutcome {
  const removalArguments = ['worktree', 'remove', worktreePath];
  const run              = runGit(mainCheckoutDirectory, removalArguments);
  if (run !== null && run.exitCode === GIT_SUCCESS_EXIT_CODE) return { verdict: 'removed' };
  return { verdict: 'left', reason: failureReasonOf(run, removalArguments), filesLeft: filesLeftIn(worktreePath) };
}

/** `-d`, never `-D`: git deletes only a branch the main checkout's HEAD already holds. */
export function deleteMergedBranch(mainCheckoutDirectory: string, branch: string): BranchDeletionOutcome {
  const deletionArguments = ['branch', '-d', branch];
  const run               = runGit(mainCheckoutDirectory, deletionArguments);
  if (run !== null && run.exitCode === GIT_SUCCESS_EXIT_CODE) return { verdict: 'deleted' };
  return { verdict: 'left', reason: failureReasonOf(run, deletionArguments) };
}
