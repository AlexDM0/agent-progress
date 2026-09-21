/**
 * What a group of subagent transcripts cost, as one row of figures, and the split that makes two
 * groups comparable across a change in how agents are briefed. It lives beside
 * `lib/utils/TranscriptUsageUtil.ts` rather than inside `cli/usage/UsageCommand.ts` because the
 * arithmetic is a pure function of the profiles: the command finds the files, this decides what the
 * numbers mean, and the claim is unit-tested against constructed arrays rather than through a folder
 * of recorded sessions nobody can reproduce.
 *
 * **Calls and end context are medians; the token figures are means, and the difference is
 * deliberate.** A call count is bounded and one runaway agent — a screenshot loop cost a single
 * agent about 40 consecutive calls — would drag a mean somewhere no agent actually was, so the
 * median answers "what did a typical agent do". Input and output are what the bill is, and a bill is
 * a sum: taking the median there would hide exactly the agent that spent 32.1 million tokens, which
 * is the one worth finding.
 */
import { TimeUtil }               from './TimeUtil';
import type { TranscriptProfile } from './TranscriptUsageUtil';

/** `transcriptCount` is on the summary rather than left to the caller, so a printed line can say how many agents it is speaking for. */
export interface CohortSummary {
  transcriptCount:                 number;
  medianApiCallCount:              number;
  medianEndContextTokens:          number;
  meanTotalInputTokens:            number;
  meanOutputTokens:                number;
  meanBrowserCallCount:            number;
  meanOversizedContextShare:       number;
  meanBashEditScriptCount:         number;
  meanVerificationRunCount:        number;
  meanNestedInstructionCharacters: number;
}

export interface CohortSplit {
  before: TranscriptProfile[];
  after:  TranscriptProfile[];
}

function totalInputTokensOf(profile: TranscriptProfile): number {
  return profile.inputTokens + profile.cacheReadInputTokens + profile.cacheCreationInputTokens;
}

/** A fraction of the agent's own input, so one enormous agent does not decide the cohort's share on its own; an agent that sent nothing reads as 0. */
function oversizedContextShareOf(profile: TranscriptProfile): number {
  const totalInputTokens = totalInputTokensOf(profile);
  return totalInputTokens === 0 ? 0 : profile.oversizedContextTokens / totalInputTokens;
}

/** An even count averages the two middle values, so a cohort of two agents reports a figure between them rather than the later one. */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted     = [...values].sort((a, b) => a - b);
  const middle     = Math.floor(sorted.length / 2);
  const lowerValue = sorted[middle - 1] ?? 0;
  const upperValue = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upperValue : (lowerValue + upperValue) / 2;
}

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((running, value) => running + value, 0) / values.length;
}

/**
 * Token figures are rounded to whole counts because a fraction of a token is not a thing anyone can
 * spend; the mean counts and the mean oversized share are **not** rounded, because a cohort where one
 * agent in ten used the browser has to read as 0.1 rather than as 0. An empty cohort answers zero of everything rather
 * than `null`, so a caller printing a summary for a side of a split that nothing fell into still has
 * a line to print.
 */
function summariseCohort(profiles: readonly TranscriptProfile[]): CohortSummary {
  return {
    transcriptCount:                 profiles.length,
    medianApiCallCount:              medianOf(profiles.map((profile) => profile.apiCallCount)),
    medianEndContextTokens:          Math.round(medianOf(profiles.map((profile) => profile.endContextTokens))),
    meanTotalInputTokens:            Math.round(meanOf(profiles.map(totalInputTokensOf))),
    meanOutputTokens:                Math.round(meanOf(profiles.map((profile) => profile.outputTokens))),
    meanBrowserCallCount:            meanOf(profiles.map((profile) => profile.browserCallCount)),
    meanOversizedContextShare:       meanOf(profiles.map(oversizedContextShareOf)),
    meanBashEditScriptCount:         meanOf(profiles.map((profile) => profile.bashEditScriptCount)),
    meanVerificationRunCount:        meanOf(profiles.map((profile) => profile.verificationRunCount)),
    meanNestedInstructionCharacters: Math.round(meanOf(profiles.map((profile) => profile.nestedInstructionCharacters))),
  };
}

/**
 * Splits a cohort on an instant: `before` is everything that started strictly earlier, `after`
 * everything that started at the instant or later. **A profile whose transcript carries no readable
 * stamp goes into `before`**, which is the closed answer: an agent that cannot be shown to have run
 * after the change must not be counted as evidence that the change helped.
 */
function splitAt(profiles: readonly TranscriptProfile[], instant: Date): CohortSplit {
  const split: CohortSplit = { before: [], after: [] };
  for (const profile of profiles) {
    const startedAt = profile.startedAt === null ? null : TimeUtil.parseIso(profile.startedAt);
    if (startedAt !== null && startedAt.getTime() >= instant.getTime()) split.after.push(profile);
    else split.before.push(profile);
  }
  return split;
}

export const TranscriptCohortUtil = {
  splitAt,
  summariseCohort,
} as const;
