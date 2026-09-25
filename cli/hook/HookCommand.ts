/**
 * The `SubagentStop` hook: logs what a finished subagent cost and adds it to the rows its brief names. Every failure is one sentence on
 * standard error at exit 0, since the agent has already stopped and a non-zero exit would prevent nothing.
 */
import { readFileSync } from 'node:fs';
import { homedir }      from 'node:os';

import { reviewedTicketNumberOf }               from '../../lib/render/page/PageMarkup';
import type { TranscriptUsageTotals }           from '../../src/lib/claude-code/utils/TranscriptUsageUtil';
import { TranscriptUsageUtil }                  from '../../src/lib/claude-code/utils/TranscriptUsageUtil';
import type { TokenCredit, TokenCreditOutcome } from '../../src/lib/tracker-model/@types/BoardChanges';
import type { AgentUsage }                      from '../../src/lib/tracker-model/@types/LogRecord';
import type { Task }                            from '../../src/lib/tracker-model/@types/Task';
import type { Board }                           from '../../src/lib/tracker-model/Board';
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

/**
 * A share of the agent's input and what the brief named it against: a row directly, a ticket whose row is looked up when the hook runs,
 * or a ticket whose newest review row is, since a reviewer files its own row after its brief was written.
 */
type BriefShare =
  | { target: 'row'; rowIdentifier: number; tokens: number }
  | { target: 'ticket'; ticketIdentifier: string; tokens: number }
  | { target: 'review'; ticketIdentifier: string; tokens: number };

/** A share turned into what the Board credits, or the sentence saying why it never reached the Board. */
type ResolvedShare =
  | { kind: 'credit'; credit: TokenCredit }
  | { kind: 'unrecorded'; sentence: string };

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
  briefShares: readonly BriefShare[],
): Promise<void> {
  const trackerContext: CommandContext = { ...context, currentDirectory: workingDirectory };
  let unrecordedShareSentences: string[] = [];
  try {
    unrecordedShareSentences = await openTrackerForWriting(commandArguments, trackerContext, (change) => {
      const resolvedShares = briefShares.map((share) => resolvedShareOf(change.board, share));
      const credits        = resolvedShares.flatMap((resolved) => (resolved.kind === 'credit' ? [resolved.credit] : []));
      const { outcomes }   = change.board.recordAgentStop(usage, credits, change.at);
      return unrecordedSentencesInShareOrder(resolvedShares, outcomes);
    });
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    context.standardError(`${REPORT_PREFIX} the line could not be recorded in ${workingDirectory}: ${reason}`);
  }
  for (const sentence of unrecordedShareSentences) context.standardError(`${REPORT_PREFIX} ${sentence}`);
}

/**
 * Row ids only ever grow, so the highest one is the review filed last. Its status is not consulted: `release` has already delivered the
 * bar by the time its reviewer stops. Linked by `reviewOf` or by the name the page nests by, through the page's own reader of both.
 */
function newestReviewRowOf(tasks: readonly Readonly<Task>[], ticketIdentifier: string): Readonly<Task> | undefined {
  const reviewedNumber = Number(ticketIdentifier);
  return tasks
    .filter((task) => task.ticket === null && reviewedTicketNumberOf(task) === reviewedNumber)
    .reduce<Readonly<Task> | undefined>((newest, task) => (newest === undefined || task.id > newest.id ? task : newest), undefined);
}

/** A review share is resolved to its row here, under the lock; a ticket share is resolved by the Board. */
function resolvedShareOf(board: Board, share: BriefShare): ResolvedShare {
  if (share.target === 'row') return { kind: 'credit', credit: { target: 'row', taskId: share.rowIdentifier, tokens: share.tokens } };
  if (share.target === 'ticket') return { kind: 'credit', credit: { target: 'ticket', ticketId: share.ticketIdentifier, tokens: share.tokens } };

  const reviewRow = newestReviewRowOf(board.tasks(), share.ticketIdentifier);
  if (reviewRow === undefined) {
    return { kind: 'unrecorded', sentence: `the brief names the review of ticket #${share.ticketIdentifier}, which has no review row, ${SHARE_NOT_RECORDED}` };
  }
  return { kind: 'credit', credit: { target: 'row', taskId: reviewRow.id, tokens: share.tokens } };
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
  }
}

/** The Board answers one outcome per credit, in the order it was handed them, so each credited share takes the next outcome. */
function unrecordedSentencesInShareOrder(resolvedShares: readonly ResolvedShare[], outcomes: readonly TokenCreditOutcome[]): string[] {
  const sentences: string[] = [];
  let outcomeIndex          = 0;
  for (const resolved of resolvedShares) {
    if (resolved.kind === 'unrecorded') {
      sentences.push(resolved.sentence);
      continue;
    }
    const outcome = outcomes[outcomeIndex];
    outcomeIndex++;
    const sentence = outcome === undefined ? undefined : unrecordedSentenceOf(outcome);
    if (sentence !== undefined) sentences.push(sentence);
  }
  return sentences;
}

/**
 * The brief's marker decides which rows the agent's `input` total is added to, split evenly over what it names. A brief carrying
 * several is read by one alone, `row:` over `ticket:` over `review:`, the most direct first: adding more would count the agent twice.
 */
function briefSharesFor(transcriptText: string, totals: TranscriptUsageTotals): BriefShare[] {
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
    return rowIdentifiers.map((rowIdentifier, i) => ({ target: 'row', rowIdentifier, tokens: shares[i] ?? 0 }));
  }

  const ticketIdentifiers = ticketIdentifiersNamedInBrief(transcriptText);
  if (ticketIdentifiers.length > 0) {
    const shares = evenSharesOf(totalInputTokens, ticketIdentifiers.length);
    return ticketIdentifiers.map((ticketIdentifier, i) => ({ target: 'ticket', ticketIdentifier, tokens: shares[i] ?? 0 }));
  }

  const reviewedTicketIdentifier = reviewedTicketIdentifierNamedInBrief(transcriptText);
  if (reviewedTicketIdentifier === null) return [];
  return [{ target: 'review', ticketIdentifier: reviewedTicketIdentifier, tokens: totalInputTokens }];
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
  await recordInTheTracker(commandArguments, context, workingDirectory, agentUsageOf(hookInput, totals), briefSharesFor(transcriptText, totals));
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
