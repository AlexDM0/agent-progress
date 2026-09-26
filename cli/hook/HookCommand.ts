/**
 * The `SubagentStop` hook: logs what a finished subagent cost and adds it to the rows its brief names. Every failure is one sentence on
 * standard error at exit 0, since the agent has already stopped and a non-zero exit would prevent nothing.
 */
import { readFileSync } from 'node:fs';
import { homedir }      from 'node:os';

import type { TranscriptUsageTotals }           from '../../src/lib/claude-code/utils/TranscriptUsageUtil';
import { TranscriptUsageUtil }                  from '../../src/lib/claude-code/utils/TranscriptUsageUtil';
import type { TokenCredit, TokenCreditOutcome } from '../../src/lib/tracker-model/@types/BoardChanges';
import type { AgentUsage }                      from '../../src/lib/tracker-model/@types/LogRecord';
import { OperationRefusal }                     from '../../src/shared/OperationRefusal';
import { LIMITS }                               from '../../src/shared/constants/Limits';
import type { CommandContext }                  from '../CommandContext';
import { openTrackerForWriting }                from '../CommandSupport';
import type { CommandHandler }                  from '../CommandTable';
import type { ArgumentParser }                  from '../arguments/ArgumentParser';
import { SubagentStopUtil }                     from './utils/SubagentStopUtil';

const USAGE = 'agent-progress hook subagent-stop  (the hook JSON arrives on standard input)';

const SUBAGENT_STOP_EVENT = 'subagent-stop';

const KNOWN_OPTION_NAMES: readonly string[] = [];

const UNKNOWN_AGENT = 'unknown';

/** The prefix on every sentence this writes, so a line in a harness log says which command produced it. */
const REPORT_PREFIX = 'agent-progress hook subagent-stop:';

const SHARE_NOT_RECORDED = 'so its share of the tokens was not recorded.';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The harness writes the transcript path with a `~`, and `readFileSync` has no shell to expand it for it. */
function expandLeadingTilde(path: string): string {
  return path.startsWith('~') ? `${homedir()}${path.slice(1)}` : path;
}

function transcriptTextAt(transcriptPath: string): string | undefined {
  try {
    return readFileSync(transcriptPath, 'utf8');
  } catch {
    // The reason is never worth more than the sentence the caller writes: the transcript is either there or it is not.
    return undefined;
  }
}

async function readHookInput(context: CommandContext): Promise<Record<string, unknown> | undefined> {
  let rawHookInput: string;
  try {
    rawHookInput = await context.readStandardInput();
  } catch {
    context.standardError(`${REPORT_PREFIX} standard input could not be read, so nothing was recorded.`);
    return undefined;
  }

  if (rawHookInput.trim().length === 0) {
    context.standardError(`${REPORT_PREFIX} no hook input arrived on standard input, so nothing was recorded.`);
    return undefined;
  }

  let parsedHookInput: unknown;
  try {
    parsedHookInput = JSON.parse(rawHookInput);
  } catch {
    context.standardError(`${REPORT_PREFIX} the hook input on standard input is not JSON, so nothing was recorded.`);
    return undefined;
  }

  const hookInput = asRecord(parsedHookInput);
  if (hookInput === undefined) {
    context.standardError(`${REPORT_PREFIX} the hook input is not a JSON object, so nothing was recorded.`);
    return undefined;
  }
  return hookInput;
}

/**
 * The tracker is resolved from the hook input's `cwd`, not from this process's: the hook runs wherever
 * the harness happens to be, and the agent that stopped may have been working in a worktree. A
 * worktree still finds the main checkout's tracker, because `lib/platform/Workspace.ts` asks git for
 * the common directory — so this only has to hand the walk the right place to start.
 */
async function recordInTheTracker(
  commandArguments: ArgumentParser,
  context: CommandContext,
  workingDirectory: string,
  usage: AgentUsage,
  briefCredits: readonly TokenCredit[],
): Promise<void> {
  const trackerContext: CommandContext = { ...context, currentDirectory: workingDirectory };
  let unrecordedShareSentences: string[] = [];
  try {
    unrecordedShareSentences = await openTrackerForWriting(commandArguments, trackerContext, (change) => {
      const { outcomes } = change.board.recordAgentStop(usage, briefCredits, change.at);
      return outcomes.flatMap((outcome) => unrecordedSentenceOf(outcome) ?? []);
    });
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    context.standardError(`${REPORT_PREFIX} the line could not be recorded in ${workingDirectory}: ${reason}`);
  }
  for (const sentence of unrecordedShareSentences) context.standardError(`${REPORT_PREFIX} ${sentence}`);
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
 * The Board resolves a ticket's share to its row and a review share to the ticket's newest review bar when the hook runs.
 */
function briefCreditsFor(transcriptText: string, totals: TranscriptUsageTotals): TokenCredit[] {
  const {
    evenSharesOf,
    reviewedTicketIdentifierNamedInBrief,
    rowIdentifiersNamedInBrief,
    ticketIdentifiersNamedInBrief,
  } = SubagentStopUtil;
  const { totalInputTokensOf } = TranscriptUsageUtil;
  const totalInputTokens = totalInputTokensOf(totals);

  const rowIdentifiers = rowIdentifiersNamedInBrief(transcriptText);
  if (rowIdentifiers.length > 0) {
    const shares = evenSharesOf(totalInputTokens, rowIdentifiers.length);
    return rowIdentifiers.map((taskId, i) => ({ target: 'row', taskId, tokens: shares[i] ?? 0 }));
  }

  const ticketIdentifiers = ticketIdentifiersNamedInBrief(transcriptText);
  if (ticketIdentifiers.length > 0) {
    const shares = evenSharesOf(totalInputTokens, ticketIdentifiers.length);
    return ticketIdentifiers.map((ticketId, i) => ({ target: 'ticket', ticketId, tokens: shares[i] ?? 0 }));
  }

  const reviewedTicketIdentifier = reviewedTicketIdentifierNamedInBrief(transcriptText);
  if (reviewedTicketIdentifier === null) return [];
  return [{ target: 'review', ticketId: reviewedTicketIdentifier, tokens: totalInputTokens }];
}

function agentUsageOf(hookInput: Record<string, unknown>, totals: TranscriptUsageTotals): AgentUsage {
  return {
    agentId:              readStringField(hookInput, 'agent_id') ?? UNKNOWN_AGENT,
    agentType:            readStringField(hookInput, 'agent_type') ?? UNKNOWN_AGENT,
    apiCallCount:         totals.apiCallCount,
    endContextTokens:     totals.endContextTokens,
    totalInputTokens:     TranscriptUsageUtil.totalInputTokensOf(totals),
    cacheReadInputTokens: totals.cacheReadInputTokens,
    outputTokens:         totals.outputTokens,
  };
}

async function recordSubagentStop(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const hookInput = await readHookInput(context);
  if (hookInput === undefined) return;

  const transcriptPath = readStringField(hookInput, 'agent_transcript_path');
  if (transcriptPath === undefined) {
    context.standardError(`${REPORT_PREFIX} the hook input carries no agent_transcript_path, so nothing was recorded.`);
    return;
  }

  const expandedTranscriptPath = expandLeadingTilde(transcriptPath);
  const transcriptText         = transcriptTextAt(expandedTranscriptPath);
  if (transcriptText === undefined) {
    context.standardError(`${REPORT_PREFIX} the transcript at ${expandedTranscriptPath} could not be read, so nothing was recorded.`);
    return;
  }

  const totals: TranscriptUsageTotals = TranscriptUsageUtil.summariseTranscriptUsage(transcriptText, LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS);
  if (totals.apiCallCount === 0) {
    context.standardError(`${REPORT_PREFIX} the transcript at ${expandedTranscriptPath} holds no API calls, so nothing was recorded.`);
    return;
  }

  const workingDirectory = readStringField(hookInput, 'cwd') ?? context.currentDirectory;
  await recordInTheTracker(commandArguments, context, workingDirectory, agentUsageOf(hookInput, totals), briefCreditsFor(transcriptText, totals));
}

/**
 * The event name is the one thing this does refuse, with exit 1: a hook the harness runs always
 * spells it, so a missing or misspelled word is a person typing the command by hand and is worth
 * saying out loud. Everything after the arguments are read is reported and forgiven.
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
