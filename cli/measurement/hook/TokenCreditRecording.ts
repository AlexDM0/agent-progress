/** Which rows a stopped agent's brief credits with its tokens, and the write that records the stop, reporting every share it could not place. */
import { OperationRefusalWordingUtil }          from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import type { TranscriptUsageTotals }           from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import { TranscriptUsageUtil }                  from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import type { TokenCredit, TokenCreditOutcome } from '../../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { AgentUsage }                      from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import { refusalIsOperationRefusal }            from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                  from '../../CommandContext.ts';
import { requireCurrentInstall }                from '../../InstallVersionCheck.ts';
import { openTrackerForWriting }                from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                  from '../../arguments/ArgumentParser.ts';
import { REPORT_PREFIX }                        from './HookInput.ts';
import { SubagentStopUtil }                     from './utils/SubagentStopUtil.ts';

const SHARE_NOT_RECORDED = 'so its share of the tokens was not recorded.';

function failureReasonOf(failure: unknown): string {
  if (refusalIsOperationRefusal(failure)) return OperationRefusalWordingUtil.messageOf(failure);
  if (failure instanceof Error) return failure.message;
  return String(failure);
}

function unrecordedSentenceOf(outcome: TokenCreditOutcome): string | undefined {
  switch (outcome.verdict) {
    case 'credited':
      return undefined;
    case 'unknown-row':
      return `the brief names row #${outcome.taskId}, which the tracker does not hold, ${SHARE_NOT_RECORDED}`;
    case 'unknown-ticket':
      return `the brief names ticket #${outcome.ticketId}, which the tracker does not hold, ${SHARE_NOT_RECORDED}`;
    case 'ticket-without-row':
      return `the brief names ticket #${outcome.ticketId}, which has no row yet, ${SHARE_NOT_RECORDED}`;
    case 'ticket-row-missing':
      return `the brief names ticket #${outcome.ticketId}, whose row #${outcome.taskId} the tracker does not hold, ${SHARE_NOT_RECORDED}`;
    case 'ticket-without-review-bar':
      return `the brief names the review of ticket #${outcome.ticketId}, which has no review row, ${SHARE_NOT_RECORDED}`;
  }
}

/**
 * The brief's marker decides which rows the agent's `input` total is added to, split evenly over what it names. A brief carrying
 * several is read by one alone, `row:` over `ticket:` over `review:`, the most direct first: adding more would count the agent twice.
 */
export function briefCreditsFor(transcriptText: string, totals: TranscriptUsageTotals): TokenCredit[] {
  const totalInputTokens = TranscriptUsageUtil.totalInputTokensOf(totals);

  const rowIdentifiers = SubagentStopUtil.rowIdentifiersNamedInBrief(transcriptText);
  if (rowIdentifiers.length > 0) {
    const shares = SubagentStopUtil.evenSharesOf(totalInputTokens, rowIdentifiers.length);
    return rowIdentifiers.map((taskId, i) => ({ target: 'row', taskId, tokens: shares[i] ?? 0 }));
  }

  const ticketIdentifiers = SubagentStopUtil.ticketIdentifiersNamedInBrief(transcriptText);
  if (ticketIdentifiers.length > 0) {
    const shares = SubagentStopUtil.evenSharesOf(totalInputTokens, ticketIdentifiers.length);
    return ticketIdentifiers.map((ticketId, i) => ({ target: 'ticket', ticketId, tokens: shares[i] ?? 0 }));
  }

  const reviewedTicketIdentifier = SubagentStopUtil.reviewedTicketIdentifierNamedInBrief(transcriptText);
  if (reviewedTicketIdentifier === null) return [];
  return [{ target: 'review', ticketId: reviewedTicketIdentifier, tokens: totalInputTokens }];
}

/**
 * The tracker is resolved from the hook input's `cwd`, not from this process's: the hook runs wherever
 * the harness happens to be, and the agent that stopped may have been working in a worktree. A
 * worktree still finds the main checkout's tracker, because `src/services/tracker/Workspace.ts` asks git for
 * the common directory — so this only has to hand the walk the right place to start.
 */
export async function recordInTheTracker(
  commandArguments: ArgumentParser,
  context: CommandContext,
  workingDirectory: string,
  usage: AgentUsage,
  briefCredits: readonly TokenCredit[],
): Promise<void> {
  const trackerContext: CommandContext = { ...context, currentDirectory: workingDirectory };
  let unrecordedShareSentences: string[] = [];
  try {
    requireCurrentInstall(workingDirectory);
    unrecordedShareSentences = await openTrackerForWriting(commandArguments, trackerContext, (change) => {
      const { outcomes } = change.board.recordAgentStop(usage, briefCredits, change.at);
      return outcomes.flatMap((outcome) => unrecordedSentenceOf(outcome) ?? []);
    });
  } catch (failure) {
    context.standardError(`${REPORT_PREFIX} the line could not be recorded in ${workingDirectory}: ${failureReasonOf(failure)}`);
  }
  for (const sentence of unrecordedShareSentences) context.standardError(`${REPORT_PREFIX} ${sentence}`);
}
