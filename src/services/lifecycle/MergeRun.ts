/**
 * The git steps of one merge in its slot worktree (design section 6.3), as verdicts: the one merge-in against the recorded target tip,
 * the restore to the recorded branch tip an abort or a requeue starts from, V10 on a resolution and the resolution's size.
 */
import { readMergeResolutionDiff } from '../../lib/git/BranchDiffs.ts';
import {
  mergeIn,
  resetTo,
  type MergeOutcome,
  type TipRestoreOutcome
} from '../../lib/git/BranchMerge.ts';
import { GitProcess }          from '../../lib/git/GitProcess.ts';
import type { MergeSlot }      from '../../lib/tracker-model/@types/Job.ts';
import { VERIFICATION_CHECKS } from './JobVerification.ts';

const DIFF_FILE_HEADER = /^(?:\+\+\+|---) /;
const CHANGED_LINE     = /^[+-]/;

function mergeIsInProgress(worktreePath: string): boolean {
  return GitProcess.resolvedCommitOf(worktreePath, 'MERGE_HEAD') !== null;
}

function headOf(worktreePath: string): string | null {
  return GitProcess.resolvedCommitOf(worktreePath, 'HEAD');
}

function treeOf(worktreePath: string): string | null {
  const run = GitProcess.run(worktreePath, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}']);
  return GitProcess.succeeded(run) ? run.standardOutput.trim() : null;
}

/** Against the recorded commit, never the moving name: a branch already descending from it is left as it is. */
function mergeInOnce(worktreePath: string, slot: Readonly<MergeSlot>): MergeOutcome {
  return mergeIn(worktreePath, slot.targetTip);
}

/** An unfinished merge is aborted first, then the worktree is reset to the tip the slot recorded, so the next attempt holds one merge-in. */
function restoreBranchTip(worktreePath: string, branchTip: string): TipRestoreOutcome {
  if (mergeIsInProgress(worktreePath)) GitProcess.run(worktreePath, ['merge', '--abort']);
  return resetTo(worktreePath, branchTip);
}

/** V10: nothing left unmerged, the conflicted files clean of whitespace errors, and a merge commit whose parents are the two recorded tips. */
function resolutionIsSound(worktreePath: string, slot: Readonly<MergeSlot>, conflictedFiles: readonly string[]): boolean {
  return VERIFICATION_CHECKS.V10({
    role:             'resolver',
    worktreePath,
    startCommit:      slot.branchTip,
    report:           null,
    ticketBody:       '',
    bodyHashAtLaunch: '',
    merge:            { branchTip: slot.branchTip, targetTip: slot.targetTip, conflictedFiles },
  }).verdict === 'passed';
}

/** The lines the merge commit at HEAD changed against git's automatic merge of its parents; `null` when git cannot tell. */
function resolutionLinesOf(worktreePath: string): number | null {
  const reading = readMergeResolutionDiff(worktreePath, 'HEAD');
  if (reading.verdict !== 'read') return null;
  return reading.diffText.split('\n').filter((line) => CHANGED_LINE.test(line) && !DIFF_FILE_HEADER.test(line)).length;
}

export const MergeRun = Object.freeze({
  headOf,
  mergeInOnce,
  mergeIsInProgress,
  resolutionIsSound,
  resolutionLinesOf,
  restoreBranchTip,
  treeOf,
});
