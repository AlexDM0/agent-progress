/**
 * Preparing and repairing linked worktrees, as verdicts: adding one on a new branch from a recorded commit, pruning the records of
 * vanished ones, removing a stale `index.lock`, and saving what a worktree holds beside its commit to a patch file. Removing a worktree
 * is `removeWorktree` in BranchIntegration, which never forces.
 */
import { unlinkSync }       from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { writeFileAtomically } from '../atomic-file/AtomicFile.ts';
import { GitProcess }          from './GitProcess.ts';

const NO_INDEX_DIFFERENCES_FOUND_EXIT_CODE = 1;

const MISSING_FILE_CODE = 'ENOENT';

export interface WorktreeRequest {
  repositoryDirectory: string;
  worktreesFolder:     string;
  worktreeName:        string;
  newBranch:           string;
  startCommit:         string;
}

export type WorktreeAdditionOutcome =
  | { verdict: 'added'; worktreePath: string; headCommit: string }
  | { verdict: 'unknown-commit' }
  | { verdict: 'refused'; reason: string };

export type WorktreePruneOutcome =
  | { verdict: 'pruned' }
  | { verdict: 'refused'; reason: string };

export type IndexLockRemovalOutcome =
  | { verdict: 'removed'; lockPath: string }
  | { verdict: 'absent'; lockPath: string }
  | { verdict: 'refused'; reason: string };

export type UncommittedWorkSaveOutcome =
  | { verdict: 'saved'; patchPath: string; untrackedFiles: string[] }
  | { verdict: 'refused'; reason: string };

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

function nulSeparatedFieldsOf(output: string): string[] {
  return output.split('\0').filter((field) => field !== '');
}

/** The start commit is resolved first, so an option-shaped one is never obeyed and the new branch starts exactly where it was recorded. */
export function addWorktreeFromCommit(request: WorktreeRequest): WorktreeAdditionOutcome {
  const startCommit = GitProcess.resolvedCommitOf(request.repositoryDirectory, request.startCommit);
  if (startCommit === null) return { verdict: 'unknown-commit' };
  const worktreePath      = join(request.worktreesFolder, request.worktreeName);
  const additionArguments = ['worktree', 'add', '--quiet', '-b', request.newBranch, worktreePath, startCommit];
  const run               = GitProcess.run(request.repositoryDirectory, additionArguments);
  if (!GitProcess.succeeded(run)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(run, additionArguments) };
  return { verdict: 'added', worktreePath, headCommit: startCommit };
}

export function pruneWorktrees(repositoryDirectory: string): WorktreePruneOutcome {
  const pruneArguments = ['worktree', 'prune'];
  const run            = GitProcess.run(repositoryDirectory, pruneArguments);
  return GitProcess.succeeded(run) ? { verdict: 'pruned' } : { verdict: 'refused', reason: GitProcess.failureReasonOf(run, pruneArguments) };
}

/**
 * The caller judges the lock stale (no git it started there is still running); this only finds the worktree's own lock, which in a
 * linked worktree lives under the main repository's `.git/worktrees/`, and removes it.
 */
export function removeStaleIndexLock(worktreePath: string): IndexLockRemovalOutcome {
  const lockPathArguments = ['rev-parse', '--git-path', 'index.lock'];
  const run               = GitProcess.run(worktreePath, lockPathArguments);
  if (!GitProcess.succeeded(run)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(run, lockPathArguments) };
  const printedPath = run.standardOutput.trim();
  const lockPath    = isAbsolute(printedPath) ? printedPath : join(worktreePath, printedPath);
  try {
    unlinkSync(lockPath);
    return { verdict: 'removed', lockPath };
  } catch (error) {
    if (errorCodeOf(error) === MISSING_FILE_CODE) return { verdict: 'absent', lockPath };
    return { verdict: 'refused', reason: `${lockPath} could not be removed: ${String(error)}` };
  }
}

/** Each untracked file as a new-file patch against `/dev/null`, so the saved patch applies with one `git apply` on the same commit. */
function untrackedFilePatchOf(worktreePath: string, untrackedFile: string): string | null {
  const run = GitProcess.run(worktreePath, ['diff', '--no-index', '--binary', '--', '/dev/null', untrackedFile]);
  if (run === null || run.exitCode !== NO_INDEX_DIFFERENCES_FOUND_EXIT_CODE) return null;
  return run.standardOutput;
}

/**
 * `git diff HEAD` (binary-safe) followed by every untracked, not ignored file as a new file, written atomically to the patch path. Nothing
 * in the worktree changes. Any step that fails refuses, and a refusal leaves no partial patch claimed as saved.
 */
export function saveUncommittedWork(worktreePath: string, patchPath: string): UncommittedWorkSaveOutcome {
  const trackedArguments = ['diff', '--binary', 'HEAD', '--'];
  const trackedRun       = GitProcess.run(worktreePath, trackedArguments);
  if (!GitProcess.succeeded(trackedRun)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(trackedRun, trackedArguments) };
  const untrackedArguments = ['ls-files', '--others', '--exclude-standard', '-z'];
  const untrackedRun       = GitProcess.run(worktreePath, untrackedArguments);
  if (!GitProcess.succeeded(untrackedRun)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(untrackedRun, untrackedArguments) };

  const untrackedFiles = nulSeparatedFieldsOf(untrackedRun.standardOutput);
  const patchParts     = [trackedRun.standardOutput];
  for (const untrackedFile of untrackedFiles) {
    const untrackedPatch = untrackedFilePatchOf(worktreePath, untrackedFile);
    if (untrackedPatch === null) return { verdict: 'refused', reason: `git diff --no-index could not save the untracked file ${untrackedFile}.` };
    patchParts.push(untrackedPatch);
  }
  try {
    writeFileAtomically(patchPath, patchParts.join(''));
  } catch (error) {
    return { verdict: 'refused', reason: `${patchPath} could not be written: ${String(error)}` };
  }
  return { verdict: 'saved', patchPath, untrackedFiles };
}
