/** After the lock is released, the worktree and the merged branch are removed; git declining either is reported, never a failure. */
import type { BranchDeletionOutcome, FilesLeftInWorktree, WorktreeRemovalOutcome } from '../../../src/lib/git/BranchIntegration.ts';
import { deleteMergedBranch, removeWorktree }                                      from '../../../src/lib/git/BranchIntegration.ts';
import type { ReleaseRequest }                                                     from './ReleaseRequest.ts';

export type CleanupStep =
  | { target: 'worktree'; path: string; outcome: 'removed' }
  | { target: 'worktree'; path: string; outcome: 'left'; reason: string; untrackedFiles: string[]; changedFiles: string[] }
  | { target: 'branch'; name: string; outcome: 'deleted' }
  | { target: 'branch'; name: string; outcome: 'left'; reason: string };

function worktreeStep(path: string, outcome: WorktreeRemovalOutcome): CleanupStep {
  if (outcome.verdict === 'removed') return { target: 'worktree', path, outcome: 'removed' };
  return {
    target:         'worktree',
    path,
    outcome:        'left',
    reason:         outcome.reason,
    untrackedFiles: outcome.filesLeft.untrackedFiles,
    changedFiles:   outcome.filesLeft.changedFiles,
  };
}

function branchStep(name: string, outcome: BranchDeletionOutcome): CleanupStep {
  if (outcome.verdict === 'deleted') return { target: 'branch', name, outcome: 'deleted' };
  return {
    target:  'branch',
    name,
    outcome: 'left',
    reason:  outcome.reason,
  };
}

function filesLeftText({ untrackedFiles, changedFiles }: FilesLeftInWorktree): string {
  const parts = [
    ...(untrackedFiles.length === 0 ? [] : [`untracked: ${untrackedFiles.join(', ')}`]),
    ...(changedFiles.length === 0 ? [] : [`changed: ${changedFiles.join(', ')}`]),
  ];
  return parts.length === 0 ? '' : ` It holds files git would lose (${parts.join('; ')}).`;
}

export function cleanUpAfterRelease(request: ReleaseRequest, mainCheckout: string): CleanupStep[] {
  const cleanup: CleanupStep[] = [];
  if (request.worktreePath !== undefined) cleanup.push(worktreeStep(request.worktreePath, removeWorktree(mainCheckout, request.worktreePath)));
  cleanup.push(branchStep(request.branch, deleteMergedBranch(mainCheckout, request.branch)));
  return cleanup;
}

export function cleanupLine(step: CleanupStep): string {
  if (step.target === 'worktree') {
    if (step.outcome === 'removed') return `Removed the worktree ${step.path}.`;
    return `The worktree ${step.path} is still there: ${step.reason}.${filesLeftText(step)} It was not forced; remove it once they are dealt with.`;
  }
  if (step.outcome === 'deleted') return `Deleted the branch ${step.name}.`;
  return `The branch ${step.name} is still there: ${step.reason}.`;
}
