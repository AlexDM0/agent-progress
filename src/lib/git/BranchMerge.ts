/**
 * Merging a commit into a worktree and undoing it, as verdicts: the merge itself, a fast-forward, its abort back to the tip it started
 * from, a reset to a recorded commit, and the two checks of a resolution (unmerged paths, conflict markers left in files).
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { fastForwardTo, type FastForwardOutcome } from './BranchIntegration.ts';
import { GitProcess }                             from './GitProcess.ts';
import { NOT_AN_ANCESTOR_EXIT_CODE }              from './constants/GitConventions.ts';

const OPENING_CONFLICT_MARKER = /^<{7}(?: |$)/m;
const CLOSING_CONFLICT_MARKER = /^>{7}(?: |$)/m;

export type MergeOutcome =
  | { verdict: 'merged'; mergeCommit: string }
  | { verdict: 'already-descends'; headCommit: string }
  | { verdict: 'conflicted'; conflictedFiles: string[] }
  | { verdict: 'unknown-commit' }
  | { verdict: 'git-failed'; reason: string };

export type TipRestoreOutcome =
  | { verdict: 'restored'; headCommit: string }
  | { verdict: 'unknown-commit' }
  | { verdict: 'refused'; reason: string };

function nulSeparatedFieldsOf(output: string): string[] {
  return output.split('\0').filter((field) => field !== '');
}

/** `null` when git cannot answer, which a caller reads as "not known to be resolved". */
export function unmergedPathsIn(worktreePath: string): string[] | null {
  const run = GitProcess.run(worktreePath, ['diff', '--name-only', '--diff-filter=U', '-z']);
  return GitProcess.succeeded(run) ? nulSeparatedFieldsOf(run.standardOutput) : null;
}

/**
 * A file counts only with both an opening and a closing marker line, since a lone `=======` is a Markdown heading underline. A file that
 * cannot be read (deleted by the resolution) holds no marker.
 */
export function conflictMarkedFilesIn(worktreePath: string, paths: readonly string[]): string[] {
  return paths.filter((path) => {
    try {
      const content = readFileSync(join(worktreePath, path), 'utf8');
      return OPENING_CONFLICT_MARKER.test(content) && CLOSING_CONFLICT_MARKER.test(content);
    } catch {
      return false;
    }
  });
}

/** Always a merge commit (`--no-ff`), so the merge is one commit an abort or reset can name; a conflict is left in place for the caller. */
export function mergeIn(worktreePath: string, commit: string): MergeOutcome {
  const resolvedCommit = GitProcess.resolvedCommitOf(worktreePath, commit);
  if (resolvedCommit === null) return { verdict: 'unknown-commit' };
  const headCommit = GitProcess.resolvedCommitOf(worktreePath, 'HEAD');
  if (headCommit === null) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(null, ['rev-parse', 'HEAD']) };

  const ancestryArguments = ['merge-base', '--is-ancestor', resolvedCommit, headCommit];
  const ancestry          = GitProcess.run(worktreePath, ancestryArguments);
  if (GitProcess.succeeded(ancestry)) return { verdict: 'already-descends', headCommit };
  if (ancestry?.exitCode !== NOT_AN_ANCESTOR_EXIT_CODE) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(ancestry, ancestryArguments) };

  const mergeArguments = ['merge', '--no-ff', '--no-edit', '--quiet', resolvedCommit];
  const merge          = GitProcess.run(worktreePath, mergeArguments);
  if (!GitProcess.succeeded(merge)) {
    const conflictedFiles = unmergedPathsIn(worktreePath) ?? [];
    if (conflictedFiles.length > 0) return { verdict: 'conflicted', conflictedFiles };
    return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(merge, mergeArguments) };
  }
  const mergeCommit = GitProcess.resolvedCommitOf(worktreePath, 'HEAD');
  if (mergeCommit === null || mergeCommit === headCommit) {
    return { verdict: 'git-failed', reason: `git merge ${resolvedCommit} exited 0, yet HEAD is ${mergeCommit ?? 'unreadable'}.` };
  }
  return { verdict: 'merged', mergeCommit };
}

/** `merge --ff-only` into the named worktree, its hooks off like every other step here. */
export function fastForwardInto(worktreePath: string, commit: string): FastForwardOutcome {
  return fastForwardTo(worktreePath, commit, 'hooks-off');
}

function restoredUnlessHeadDiffers(worktreePath: string, expectedCommit: string, command: string): TipRestoreOutcome {
  const headCommit = GitProcess.resolvedCommitOf(worktreePath, 'HEAD');
  if (headCommit !== expectedCommit) return { verdict: 'refused', reason: `${command} exited 0, yet HEAD is ${headCommit ?? 'unreadable'}.` };
  return { verdict: 'restored', headCommit };
}

/** Restored only when HEAD is the tip recorded before the merge afterwards: an abort that left HEAD elsewhere is refused. */
export function abortMerge(worktreePath: string, preMergeTip: string): TipRestoreOutcome {
  const abortArguments = ['merge', '--abort'];
  const run            = GitProcess.run(worktreePath, abortArguments);
  if (!GitProcess.succeeded(run)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(run, abortArguments) };
  return restoredUnlessHeadDiffers(worktreePath, preMergeTip, 'git merge --abort');
}

/** `--hard`: the worktree's files are put back too. The commit is resolved first, so an option-shaped one is never obeyed. */
export function resetTo(worktreePath: string, recordedCommit: string): TipRestoreOutcome {
  const resolvedCommit = GitProcess.resolvedCommitOf(worktreePath, recordedCommit);
  if (resolvedCommit === null) return { verdict: 'unknown-commit' };
  const resetArguments = ['reset', '--hard', '--quiet', resolvedCommit];
  const run            = GitProcess.run(worktreePath, resetArguments);
  if (!GitProcess.succeeded(run)) return { verdict: 'refused', reason: GitProcess.failureReasonOf(run, resetArguments) };
  return restoredUnlessHeadDiffers(worktreePath, resolvedCommit, `git reset --hard ${resolvedCommit}`);
}
