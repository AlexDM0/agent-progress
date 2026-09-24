/**
 * The `SubagentStop` hook: logs what a finished subagent cost and adds it to the rows its brief names. Every failure is one sentence on
 * standard error at exit 0, since the agent has already stopped and a non-zero exit would prevent nothing.
 */
import { readFileSync } from 'node:fs';
import { homedir }      from 'node:os';

import type { ProgressFile, Task }       from '../../lib/constants/Types';
import { OperationRefusal }              from '../../lib/platform/OperationRefusal';
import type { Workspace }                from '../../lib/platform/Workspace';
import { addTaskTokens, appendLogEntry } from '../../lib/progress/ProgressStore';
import { reviewedTicketNumberOf }        from '../../lib/render/page/PageMarkup';
import { readTicket }                    from '../../lib/tickets/TicketStore';
import type { TranscriptUsageTotals }    from '../../lib/utils/TranscriptUsageUtil';
import { TranscriptUsageUtil }           from '../../lib/utils/TranscriptUsageUtil';
import type { CommandContext }           from '../CommandContext';
import { openTrackerForWriting }         from '../CommandSupport';
import type { CommandHandler }           from '../CommandTable';
import type { ArgumentParser }           from '../arguments/ArgumentParser';

const USAGE = 'agent-progress hook subagent-stop  (the hook JSON arrives on standard input)';

const SUBAGENT_STOP_EVENT = 'subagent-stop';

const KNOWN_OPTION_NAMES: readonly string[] = [];

const UNKNOWN_AGENT = 'unknown';

/** The prefix on every sentence this writes, so a line in a harness log says which command produced it. */
const REPORT_PREFIX = 'agent-progress hook subagent-stop:';

/**
 * A share of the agent's input and what the brief named it against: a row directly, a ticket whose row is looked up when the hook runs,
 * or a ticket whose newest review row is, since a reviewer files its own row after its brief was written.
 */
type BriefShare =
  | { target: 'row'; rowIdentifier: number; tokens: number }
  | { target: 'ticket'; ticketIdentifier: string; tokens: number }
  | { target: 'review'; ticketIdentifier: string; tokens: number };

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
  usageLine: string,
  briefShares: readonly BriefShare[],
): Promise<void> {
  const trackerContext: CommandContext = { ...context, currentDirectory: workingDirectory };
  let unrecordedShareSentences: string[] = [];
  try {
    unrecordedShareSentences = await openTrackerForWriting(commandArguments, trackerContext, (change) => {
      const sentences = briefShares
        .map((share) => addShareToItsRow(change.workspace, change.progress, share))
        .filter((sentence): sentence is string => sentence !== undefined);
      appendLogEntry(change.progress, change.at, usageLine);
      return sentences;
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
function newestReviewRowOf(progress: ProgressFile, ticketIdentifier: string): Task | undefined {
  const reviewedNumber = Number(ticketIdentifier);
  return progress.tasks
    .filter((task) => task.ticket === null && reviewedTicketNumberOf(task) === reviewedNumber)
    .reduce<Task | undefined>((newest, task) => (newest === undefined || task.id > newest.id ? task : newest), undefined);
}

/** Adds the share and answers nothing, or answers the sentence saying why it was not recorded. A ticket is resolved to its row here, under the lock. */
function addShareToItsRow(workspace: Workspace, progress: ProgressFile, share: BriefShare): string | undefined {
  const notRecorded = 'so its share of the tokens was not recorded.';
  if (share.target === 'row') {
    if (addTaskTokens(progress, share.rowIdentifier, share.tokens) === 'applied') return undefined;
    return `the brief names row #${share.rowIdentifier}, which the tracker does not hold, ${notRecorded}`;
  }

  if (share.target === 'review') {
    const reviewRow = newestReviewRowOf(progress, share.ticketIdentifier);
    if (reviewRow === undefined) return `the brief names the review of ticket #${share.ticketIdentifier}, which has no review row, ${notRecorded}`;
    addTaskTokens(progress, reviewRow.id, share.tokens);
    return undefined;
  }

  const ticket = readTicket(workspace, share.ticketIdentifier);
  if (ticket === null) return `the brief names ticket #${share.ticketIdentifier}, which the tracker does not hold, ${notRecorded}`;

  const rowIdentifier = ticket.frontmatter.task;
  if (rowIdentifier === null) return `the brief names ticket #${share.ticketIdentifier}, which has no row yet, ${notRecorded}`;

  if (addTaskTokens(progress, rowIdentifier, share.tokens) === 'applied') return undefined;
  return `the brief names ticket #${share.ticketIdentifier}, whose row #${rowIdentifier} the tracker does not hold, ${notRecorded}`;
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
    totalInputTokensOf,
  } = TranscriptUsageUtil;
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

  const totals: TranscriptUsageTotals = TranscriptUsageUtil.summariseTranscriptUsage(transcriptText);
  if (totals.apiCallCount === 0) {
    context.standardError(`${REPORT_PREFIX} the transcript at ${expandedTranscriptPath} holds no API calls, so nothing was recorded.`);
    return;
  }

  const usageLine = TranscriptUsageUtil.composeUsageLine(
    readStringField(hookInput, 'agent_id')   ?? UNKNOWN_AGENT,
    readStringField(hookInput, 'agent_type') ?? UNKNOWN_AGENT,
    totals,
  );

  const workingDirectory = readStringField(hookInput, 'cwd') ?? context.currentDirectory;
  await recordInTheTracker(commandArguments, context, workingDirectory, usageLine, briefSharesFor(transcriptText, totals));
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
