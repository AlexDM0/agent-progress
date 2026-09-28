/**
 * The `SubagentStop` hook: logs what a finished subagent cost and adds it to the rows its brief names. Every failure is one sentence on
 * standard error at exit 0, since the agent has already stopped and a non-zero exit would prevent nothing.
 */
import { agentDescriptionBeside, transcriptTextAt, workflowRunIdentifierOf } from '../../../src/lib/claude-code/ClaudeTranscripts.ts';
import type { TranscriptUsageTotals }                                        from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import { TranscriptUsageUtil }                                               from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import type { AgentUsage }                                                   from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import { OperationRefusal }                                                  from '../../../src/shared/OperationRefusal.ts';
import { LIMITS }                                                            from '../../../src/shared/constants/Limits.ts';
import type { CommandContext }                                               from '../../CommandContext.ts';
import type { CommandHandler }                                               from '../../CommandHandler.ts';
import type { ArgumentParser }                                               from '../../arguments/ArgumentParser.ts';
import {
  REPORT_PREFIX,
  UNKNOWN_AGENT,
  readHookInput,
  readStringField
}                                                        from './HookInput.ts';
import { recordInTheTracker } from './TokenCreditRecording.ts';

const USAGE = 'agent-progress hook subagent-stop  (the hook JSON arrives on standard input)';

const SUBAGENT_STOP_EVENT = 'subagent-stop';

const KNOWN_OPTION_NAMES: readonly string[] = [];

/** The harness writes the transcript path with a `~`, and `readFileSync` has no shell to expand it for it. */
function expandLeadingTilde(path: string, homeDirectory: string): string {
  return path.startsWith('~') ? `${homeDirectory}${path.slice(1)}` : path;
}

/** A plain subagent's record carries neither workflow field, so it stays as it was; the label is read only beside a workflow agent's transcript. */
function agentUsageOf(hookInput: Record<string, unknown>, totals: TranscriptUsageTotals, transcriptPath: string): AgentUsage {
  const usage: AgentUsage = {
    agentId:              readStringField(hookInput, 'agent_id') ?? UNKNOWN_AGENT,
    agentType:            readStringField(hookInput, 'agent_type') ?? UNKNOWN_AGENT,
    apiCallCount:         totals.apiCallCount,
    endContextTokens:     totals.endContextTokens,
    totalInputTokens:     TranscriptUsageUtil.totalInputTokensOf(totals),
    cacheReadInputTokens: totals.cacheReadInputTokens,
    outputTokens:         totals.outputTokens,
  };
  const workflowRunId = workflowRunIdentifierOf(transcriptPath);
  if (workflowRunId === undefined) return usage;
  const agentLabel = agentDescriptionBeside(transcriptPath);
  return agentLabel === undefined ? { ...usage, workflowRunId } : { ...usage, workflowRunId, agentLabel };
}

async function recordSubagentStop(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const hookInput = await readHookInput(context);
  if (hookInput === undefined) return;

  const transcriptPath = readStringField(hookInput, 'agent_transcript_path');
  if (transcriptPath === undefined) {
    context.standardError(`${REPORT_PREFIX} the hook input carries no agent_transcript_path, so nothing was recorded.`);
    return;
  }

  const expandedTranscriptPath = expandLeadingTilde(transcriptPath, context.homeDirectory);
  const transcriptText         = transcriptTextAt(expandedTranscriptPath);
  if (transcriptText === undefined) {
    context.standardError(`${REPORT_PREFIX} the transcript at ${expandedTranscriptPath} could not be read, so nothing was recorded.`);
    return;
  }

  const totals: TranscriptUsageTotals = TranscriptUsageUtil.usageTotalsOf(transcriptText, LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS);
  if (totals.apiCallCount === 0) {
    context.standardError(`${REPORT_PREFIX} the transcript at ${expandedTranscriptPath} holds no API calls, so nothing was recorded.`);
    return;
  }

  const workingDirectory = readStringField(hookInput, 'cwd') ?? context.currentDirectory;
  await recordInTheTracker(commandArguments, context, workingDirectory, agentUsageOf(hookInput, totals, expandedTranscriptPath), transcriptText);
}

/**
 * Its arguments are the one thing this does refuse, with exit 1: the harness always passes exactly
 * the event word, so a missing or misspelled word, an extra argument or an option is a person typing
 * the command by hand and is worth saying out loud. Everything after the arguments are read is
 * reported and forgiven.
 */
export const hookCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);

  const event = commandArguments.positional();
  if (event !== SUBAGENT_STOP_EVENT) {
    const named = event === undefined ? 'no hook event' : `"${event}"`;
    throw new OperationRefusal('refused', `agent-progress hook takes one event and was given ${named}.\n  Usage: ${USAGE}`);
  }
  commandArguments.rejectExtraPositionals(1, USAGE);

  await recordSubagentStop(commandArguments, context);
};
