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
import { GitProcess }        from '../../lib/git/GitProcess.ts';
import type { Job, Airlock } from '../../lib/tracker-model/@types/Job.ts';
import { CUSTOMS_CHECKS }    from './Customs.ts';

/** The commit the slot worktree starts from, its merge's first parent, and the one merged into it, its second. */
export interface MergeSides {
  startTip:  string;
  mergedTip: string;
}

const DIFF_FILE_HEADER = /^(?:\+\+\+|---) /;
const CHANGED_LINE     = /^[+-]/;

/** A ticket's merge starts from its branch and merges the target in; a group refresh starts from the group's tip and merges main's in. */
function sidesOf(job: Readonly<Pick<Job, 'kind'>>, slot: Readonly<Airlock>): MergeSides {
  return job.kind === 'refresh'
    ? { startTip: slot.targetTip, mergedTip: slot.branchTip }
    : { startTip: slot.branchTip, mergedTip: slot.targetTip };
}

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
function mergeInOnce(worktreePath: string, sides: Readonly<MergeSides>): MergeOutcome {
  return mergeIn(worktreePath, sides.mergedTip);
}

/** An unfinished merge is aborted first, then the worktree is reset to the tip the slot recorded, so the next attempt holds one merge-in. */
function restoreBranchTip(worktreePath: string, branchTip: string): TipRestoreOutcome {
  if (mergeIsInProgress(worktreePath)) GitProcess.run(worktreePath, ['merge', '--abort']);
  return resetTo(worktreePath, branchTip);
}

/** V10: nothing left unmerged, the conflicted files clean of whitespace errors, and a merge commit whose parents are the two recorded tips. */
function resolutionIsSound(worktreePath: string, sides: Readonly<MergeSides>, conflictedFiles: readonly string[]): boolean {
  return CUSTOMS_CHECKS.V10({
    role:             'resolver',
    worktreePath,
    startCommit:      sides.startTip,
    report:           null,
    ticketBody:       '',
    bodyHashAtLaunch: '',
    merge:            { branchTip: sides.startTip, targetTip: sides.mergedTip, conflictedFiles },
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
  sidesOf,
  treeOf,
});
