/**
 * The code-implemented worktree repairs of design section 8.3, run inside the hold that records them so no launch races them. `reinstall`
 * changes nothing on disk: the next launch on the worktree reruns the install line. `recreate` saves the worktree's changes, tracked and
 * untracked, as `recreate-<n>.patch` in the job folder before it removes the worktree, which the next launch creates again from the branch.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { isAbsolute, join }        from 'node:path';
import { GitProcess }              from '../../lib/git/GitProcess.ts';
import type { WorktreeRepairStep } from '../../shared/@types/ControlCommand.ts';

export interface WorktreeRepairRequest {
  repositoryRoot: string;
  worktreePath:   string;
  step:           WorktreeRepairStep;
  /** Where `recreate` saves its patch; `null` when no job ever ran on the worktree. */
  jobFolder:      string | null;
}

export type WorktreeRepairVerdict =
  | { verdict: 'repaired'; patchPath: string | null }
  | { verdict: 'uncommitted-work-not-saved' }
  | { verdict: 'git-failed'; reason: string };

const RECREATE_PATCH = /^recreate-(\d+)\.patch$/;

function failed(directory: string, gitArguments: readonly string[]): WorktreeRepairVerdict | null {
  const run = GitProcess.run(directory, gitArguments);
  return GitProcess.succeeded(run) ? null : { verdict: 'git-failed', reason: GitProcess.failureReasonOf(run, gitArguments) };
}

/** `git diff HEAD` and every untracked file as an addition, or `null` when git cannot read the worktree. */
function changesOf(worktreePath: string): string | null {
  const tracked   = GitProcess.run(worktreePath, ['diff', '--binary', 'HEAD']);
  const untracked = GitProcess.run(worktreePath, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!GitProcess.succeeded(tracked) || !GitProcess.succeeded(untracked)) return null;
  const additions = untracked.standardOutput.split('\0').filter((path) => path !== '').map((path) => (
    // `--no-index` exits 1 when the sides differ, which they always do here.
    GitProcess.run(worktreePath, ['diff', '--binary', '--no-index', '--', '/dev/null', path])?.standardOutput ?? null
  ));
  if (additions.includes(null)) return null;
  return [tracked.standardOutput, ...additions].join('');
}

function nextPatchPathIn(jobFolder: string): string {
  const names   = existsSync(jobFolder) ? readdirSync(jobFolder) : [];
  const numbers = names.flatMap((name) => {
    const match = RECREATE_PATCH.exec(name);
    return match === null ? [] : [Number(match[1])];
  });
  return join(jobFolder, `recreate-${Math.max(0, ...numbers) + 1}.patch`);
}

/** Saved, or nothing to save; `null` when there are changes and they could not be written. */
function savedChangesOf(worktreePath: string, jobFolder: string | null): { patchPath: string | null } | null {
  const changes = changesOf(worktreePath);
  if (changes === '') return { patchPath: null };
  if (changes === null || jobFolder === null) return null;
  try {
    mkdirSync(jobFolder, { recursive: true });
    const patchPath = nextPatchPathIn(jobFolder);
    writeFileSync(patchPath, changes, { flag: 'wx' });
    return { patchPath };
  } catch {
    return null;
  }
}

function recreate(request: WorktreeRepairRequest): WorktreeRepairVerdict {
  if (!existsSync(request.worktreePath)) return failed(request.repositoryRoot, ['worktree', 'prune']) ?? { verdict: 'repaired', patchPath: null };
  const saved = savedChangesOf(request.worktreePath, request.jobFolder);
  if (saved === null) return { verdict: 'uncommitted-work-not-saved' };
  return failed(request.repositoryRoot, ['worktree', 'remove', '--force', request.worktreePath]) ?? { verdict: 'repaired', patchPath: saved.patchPath };
}

function unlock(worktreePath: string): WorktreeRepairVerdict {
  const lockPath = GitProcess.run(worktreePath, ['rev-parse', '--git-path', 'index.lock']);
  if (!GitProcess.succeeded(lockPath)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(lockPath, ['rev-parse']) };
  const written = lockPath.standardOutput.trim();
  rmSync(isAbsolute(written) ? written : join(worktreePath, written), { force: true });
  return { verdict: 'repaired', patchPath: null };
}

function repair(request: WorktreeRepairRequest): WorktreeRepairVerdict {
  switch (request.step) {
    case 'prune':
      return failed(request.repositoryRoot, ['worktree', 'prune']) ?? { verdict: 'repaired', patchPath: null };
    case 'reinstall':
      return { verdict: 'repaired', patchPath: null };
    case 'recreate':
      return recreate(request);
    case 'unlock':
      return unlock(request.worktreePath);
  }
}

export const WorktreeRepair = Object.freeze({ repair });
