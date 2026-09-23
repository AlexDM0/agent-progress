/**
 * `agent-progress hook subagent-stop`: the `SubagentStop` hook that records what a finished subagent
 * cost, as one line in the tracker's log, and adds it to the tokens of each row the agent's brief names
 * on an `agent-progress row: <ids>` line. It exists because nothing else observes that number — a
 * subagent's usage lives only in its own transcript, and the token column read 0 on every row of a
 * 73-agent build because nobody typed `--tokens`.
 *
 * It replaces a `record-subagent-tokens.ts` script each repository copied into `.claude/hooks/`. A
 * command inside the CLI can be wired up by `agent-progress init --hooks` and tested in process,
 * which a copied script can be neither.
 *
 * **Every failure here writes one sentence to standard error and returns normally, so the exit code
 * is 0**: no input, input that is not JSON, no transcript path, a transcript it cannot read, no
 * tracker at the hook's `cwd`, a transcript with no calls in it. **A `SubagentStop` hook's exit code
 * prevents nothing** — the agent has already finished by the time the harness runs this — so the rule
 * is not about letting the agent stop. It is that a non-zero exit is an error the orchestrator then
 * has to read and account for, and a delay before it is told its agent is done, both of which cost
 * more than the log line is worth — which is why this is the one command that never throws
 * `OperationRefusal` once it has its arguments.
 */
import { readFileSync } from 'node:fs';
import { homedir }      from 'node:os';

import { OperationRefusal }              from '../../lib/platform/OperationRefusal';
import { addTaskTokens, appendLogEntry } from '../../lib/progress/ProgressStore';
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

interface RowShare {
  rowIdentifier: number;
  tokens:        number;
}

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
  rowShares: readonly RowShare[],
): Promise<void> {
  const trackerContext: CommandContext = { ...context, currentDirectory: workingDirectory };
  let missingRowIdentifiers: number[] = [];
  try {
    missingRowIdentifiers = await openTrackerForWriting(commandArguments, trackerContext, (change) => {
      const rowIdentifiersNotHeld = rowShares
        .filter((share) => addTaskTokens(change.progress, share.rowIdentifier, share.tokens) === 'no-such-task')
        .map((share) => share.rowIdentifier);
      appendLogEntry(change.progress, change.at, usageLine);
      return rowIdentifiersNotHeld;
    });
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    context.standardError(`${REPORT_PREFIX} the line could not be recorded in ${workingDirectory}: ${reason}`);
  }
  for (const rowIdentifier of missingRowIdentifiers) {
    context.standardError(`${REPORT_PREFIX} the brief names row #${rowIdentifier}, which the tracker does not hold, so its share of the tokens was not recorded.`);
  }
}

/** The brief's `agent-progress row:` line, if it has one, decides which rows the agent's `input` total is added to, split evenly. */
function rowSharesFor(transcriptText: string, totals: TranscriptUsageTotals): RowShare[] {
  const { evenSharesOf, rowIdentifiersNamedInBrief, totalInputTokensOf } = TranscriptUsageUtil;
  const rowIdentifiers = rowIdentifiersNamedInBrief(transcriptText);
  const shares         = evenSharesOf(totalInputTokensOf(totals), rowIdentifiers.length);
  return rowIdentifiers.map((rowIdentifier, i) => ({ rowIdentifier, tokens: shares[i] ?? 0 }));
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
  await recordInTheTracker(commandArguments, context, workingDirectory, usageLine, rowSharesFor(transcriptText, totals));
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
