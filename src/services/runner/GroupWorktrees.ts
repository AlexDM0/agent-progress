/**
 * A group's own worktree, `<worktrees>/group-<name>/` on `group-<name>` (design section 6.7): created from the main line's tip at the
 * group's first launch, touched afterwards only by landings, and removed with its branch once the release delivered the bundle. A refresh
 * merges main in a temporary detached worktree beside it, which its refresh job owns.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';

import { GitProcess } from '../../lib/git/GitProcess.ts';

export type GroupWorktreeVerdict = { verdict: 'ready'; path: string } | { verdict: 'git-failed'; reason: string };

const REFRESH_FOLDER_PREFIX = 'refresh-';

function groupWorktreeOf(worktreesRoot: string, groupBranch: string): string {
  return join(worktreesRoot, groupBranch);
}

function refreshWorktreeOf(worktreesRoot: string, groupBranch: string): string {
  return join(worktreesRoot, `${REFRESH_FOLDER_PREFIX}${groupBranch}`);
}

function addWorktree(repositoryRoot: string, path: string, worktreeArguments: readonly string[]): GroupWorktreeVerdict {
  if (existsSync(path)) return { verdict: 'ready', path };
  const gitArguments = ['worktree', 'add', '--quiet', ...worktreeArguments];
  const run          = GitProcess.run(repositoryRoot, gitArguments);
  return GitProcess.succeeded(run) ? { verdict: 'ready', path } : { verdict: 'git-failed', reason: GitProcess.failureReasonOf(run, gitArguments) };
}

/** The branch is made from the main line's tip only when it does not exist yet; an existing one is checked out as it stands. */
function prepareGroupWorktree(repositoryRoot: string, worktreesRoot: string, groupBranch: string, mainLine: string): GroupWorktreeVerdict {
  const path         = groupWorktreeOf(worktreesRoot, groupBranch);
  const branchExists = GitProcess.resolvedCommitOf(repositoryRoot, `refs/heads/${groupBranch}`) !== null;
  return addWorktree(repositoryRoot, path, branchExists ? [path, groupBranch] : ['-b', groupBranch, path, mainLine]);
}

/** Detached at the group's recorded tip, so nothing but the landing's `merge --ff-only` ever moves the group branch. */
function prepareRefreshWorktree(repositoryRoot: string, worktreesRoot: string, groupBranch: string, groupTip: string): GroupWorktreeVerdict {
  const path = refreshWorktreeOf(worktreesRoot, groupBranch);
  return addWorktree(repositoryRoot, path, ['--detach', path, groupTip]);
}

/** Never forced: a worktree git declines to remove stays, and the reason is handed back. */
function removeWorktree(repositoryRoot: string, path: string): string | null {
  if (!existsSync(path)) return null;
  const gitArguments = ['worktree', 'remove', path];
  const run          = GitProcess.run(repositoryRoot, gitArguments);
  return GitProcess.succeeded(run) ? null : GitProcess.failureReasonOf(run, gitArguments);
}

/** After the release: the group worktree removed, then its branch deleted with `branch -d`, which refuses an unmerged one. */
function removeGroup(repositoryRoot: string, worktreesRoot: string, groupBranch: string): string | null {
  const worktreeFailure = removeWorktree(repositoryRoot, groupWorktreeOf(worktreesRoot, groupBranch));
  if (worktreeFailure !== null) return worktreeFailure;
  const gitArguments = ['branch', '-d', groupBranch];
  const run          = GitProcess.run(repositoryRoot, gitArguments);
  return GitProcess.succeeded(run) ? null : GitProcess.failureReasonOf(run, gitArguments);
}

export const GroupWorktrees = Object.freeze({
  groupWorktreeOf,
  prepareGroupWorktree,
  prepareRefreshWorktree,
  refreshWorktreeOf,
  removeGroup,
  removeWorktree,
});
