/**
 * What one review pass changed, counted by the same reads `rework` makes: the fix commits since the review's start up to the tip before the
 * first rebase, so they equal the `rework --since` the reviewer ran before rebasing, and each rebase up to the tip the next rebase started
 * from, or HEAD for the last, as the `rework --rebased-from` run after it counted. The builder's change is measured at the review's start.
 */
import { ReworkCountUtil } from '../../../src/shared/rework/utils/ReworkCountUtil.ts';
import {
  changeSizeOf,
  countCommits,
  countRebase,
  resolvedCommitIn,
  worktreeHeadCommit
}                          from '../ReworkReading.ts';
import type { ChangeSize } from '../ReworkReading.ts';

export interface RebaseRequest {
  oldTip:   string;
  mainLine: string;
}

export interface ReviewPassRequest {
  worktreeDirectory: string;
  reviewStart:       string;
  rebases:           readonly RebaseRequest[];
  builderMainLine:   string;
}

export interface ReviewPassMeasured {
  headCommit:              string;
  reviewStartCommit:       string;
  fixReworkedCodeLines:    number;
  rebaseReworkedCodeLines: number;
  totalReworkedCodeLines:  number;
  builderChange:           ChangeSize;
}

export function measureReviewPass(request: ReviewPassRequest): ReviewPassMeasured {
  const { worktreeDirectory } = request;
  const headCommit            = worktreeHeadCommit(worktreeDirectory);
  const oldTipCommits         = request.rebases.map((rebase) => resolvedCommitIn(worktreeDirectory, rebase.oldTip, 'rebased-from'));
  const commitsPart           = countCommits(worktreeDirectory, request.reviewStart, oldTipCommits[0] ?? headCommit);
  const rebaseFileLists       = request.rebases.map((rebase, i) => countRebase(worktreeDirectory, rebase.oldTip, rebase.mainLine, oldTipCommits[i + 1] ?? headCommit).files);

  const { reworkedCodeLines: fixReworkedCodeLines }    = ReworkCountUtil.partReworkOf(commitsPart.files);
  const { reworkedCodeLines: rebaseReworkedCodeLines } = ReworkCountUtil.partReworkOf(ReworkCountUtil.combineFileReworks(rebaseFileLists));
  const { reworkedCodeLines: totalReworkedCodeLines }  = ReworkCountUtil.totalReworkOf(ReworkCountUtil.combineFileReworks([commitsPart.files, ...rebaseFileLists]));
  return {
    headCommit,
    reviewStartCommit: commitsPart.sinceCommit,
    fixReworkedCodeLines,
    rebaseReworkedCodeLines,
    totalReworkedCodeLines,
    builderChange:     changeSizeOf(worktreeDirectory, request.builderMainLine, commitsPart.sinceCommit),
  };
}
