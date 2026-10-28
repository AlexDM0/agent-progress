/** The write that records a stopped agent and credits the rows its brief names, reporting every share it could not place. */
import { OperationRefusalWordingUtil } from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import type { TokenCreditOutcome }     from '../../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { AgentUsage, LogRecord }  from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import { TokenCrediting }              from '../../../src/services/lifecycle/TokenCrediting.ts';
import { refusalIsOperationRefusal }   from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }         from '../../CommandContext.ts';
import { requireCurrentInstall }       from '../../InstallVersionCheck.ts';
import { openTrackerForWriting }       from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }         from '../../arguments/ArgumentParser.ts';
import { UNKNOWN_AGENT }               from './HookInput.ts';
import { SubagentStopUtil }            from './utils/SubagentStopUtil.ts';

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

/** An agent the input did not name cannot be told apart from another unnamed one, so it is credited whole. */
function tokensStillToCreditOf(usage: AgentUsage, storedLogRecords: readonly LogRecord[]): number {
  if (usage.agentId === UNKNOWN_AGENT) return usage.totalInputTokens;
  return TokenCrediting.tokensStillToCreditOf(usage, storedLogRecords);
}

export interface AgentStop {
  usage:     AgentUsage;
  briefText: string;
}

/**
 * The tracker is resolved from the given working directory, not from this process's: the hook runs wherever
 * the harness happens to be, and the agent that stopped may have been working in a worktree. A
 * worktree still finds the main checkout's tracker, because `src/services/tracker/Workspace.ts` asks git for
 * the common directory — so this only has to hand the walk the right place to start. Every stop is recorded in one write.
 */
export async function recordInTheTracker(
  commandArguments: ArgumentParser,
  context: CommandContext,
  reportPrefix: string,
  workingDirectory: string,
  agentStops: readonly AgentStop[],
): Promise<void> {
  const trackerContext: CommandContext = { ...context, currentDirectory: workingDirectory };
  let unrecordedShareSentences: string[] = [];
  try {
    requireCurrentInstall(workingDirectory);
    unrecordedShareSentences = await openTrackerForWriting(commandArguments, trackerContext, (change) => agentStops.flatMap(({ usage, briefText }) => {
      const tokensStillToCredit = tokensStillToCreditOf(usage, change.storedLogRecords);
      const briefCredits        = tokensStillToCredit > 0 ? SubagentStopUtil.creditsFor(briefText, tokensStillToCredit) : [];
      const { outcomes }        = change.board.recordAgentStop(usage, briefCredits, change.at);
      return outcomes.flatMap((outcome) => unrecordedSentenceOf(outcome) ?? []);
    }));
  } catch (failure) {
    context.standardError(`${reportPrefix} the line could not be recorded in ${workingDirectory}: ${failureReasonOf(failure)}`);
  }
  for (const sentence of unrecordedShareSentences) context.standardError(`${reportPrefix} ${sentence}`);
}
