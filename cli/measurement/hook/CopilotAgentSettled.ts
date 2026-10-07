/**
 * Copilot CLI's own hooks carry no token counts, so its extension runs this once per settled agent with the agent's prompt and
 * running totals, and once at startup with `--session` to credit what a session's shutdown summary holds. Every failure is one
 * sentence on standard error at exit 0, as for `hook subagent-stop`.
 */
import type { CopilotSessionAgent, CopilotTokenUsage } from '../../../src/lib/copilot-cli/CopilotSessionEvents.ts';
import {
  copilotTokenUsageOf,
  readCopilotSession,
  sessionEventsPathOf,
  sessionEventsTextAt
} from '../../../src/lib/copilot-cli/CopilotSessionEvents.ts';
import type { AgentUsage }                               from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import type { CommandContext }                           from '../../CommandContext.ts';
import type { ArgumentParser }                           from '../../arguments/ArgumentParser.ts';
import { UNKNOWN_AGENT, readHookInput, readStringField } from './HookInput.ts';
import type { AgentStop }                                from './TokenCreditRecording.ts';
import { recordInTheTracker }                            from './TokenCreditRecording.ts';

const COPILOT_REPORT_PREFIX = 'agent-progress hook copilot-agent-settled:';

const NOTHING_RECORDED = 'nothing was recorded';

/** Copilot's `inputTokens` already holds its cache reads and writes, so it alone is the input Claude's total counts. */
function agentUsageOf(agentIdentifier: string, agentType: string, label: string | undefined, apiCallCount: number, usage: CopilotTokenUsage): AgentUsage {
  const agentUsage: AgentUsage = {
    agentId:              agentIdentifier,
    agentType,
    apiCallCount,
    endContextTokens:     0,
    totalInputTokens:     usage.inputTokens,
    cacheReadInputTokens: usage.cacheReadTokens,
    outputTokens:         usage.outputTokens,
  };
  return label === undefined ? agentUsage : { ...agentUsage, agentLabel: label };
}

function sessionAgentStopOf(agent: CopilotSessionAgent): AgentStop {
  return {
    usage:     agentUsageOf(agent.agentId, agent.agentName ?? UNKNOWN_AGENT, agent.displayName, agent.requestCount, agent.usage),
    briefText: agent.prompt,
  };
}

async function repositoryRootFromInput(context: CommandContext): Promise<{ input: Record<string, unknown>; repositoryRoot: string } | undefined> {
  const input = await readHookInput(context, COPILOT_REPORT_PREFIX, NOTHING_RECORDED);
  if (input === undefined) return undefined;
  const repositoryRoot = readStringField(input, 'repositoryRoot');
  if (repositoryRoot === undefined) {
    context.standardError(`${COPILOT_REPORT_PREFIX} the input carries no repositoryRoot, so ${NOTHING_RECORDED}.`);
    return undefined;
  }
  return { input, repositoryRoot };
}

/** An agent that failed before its first model call settles with zero totals, which credit nothing. */
export async function recordSettledCopilotAgent(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const settledInput = await repositoryRootFromInput(context);
  if (settledInput === undefined) return;
  const { input, repositoryRoot } = settledInput;

  const agentIdentifier = readStringField(input, 'agentId');
  const { prompt }      = input;
  const usage           = copilotTokenUsageOf(input['usage']);
  if (agentIdentifier === undefined || typeof prompt !== 'string' || usage === undefined) {
    context.standardError(`${COPILOT_REPORT_PREFIX} the input needs an agentId, a prompt and whole usage counts, so ${NOTHING_RECORDED}.`);
    return;
  }
  if (usage.inputTokens === 0) {
    context.standardError(`${COPILOT_REPORT_PREFIX} agent ${agentIdentifier} settled with no input tokens, so ${NOTHING_RECORDED}.`);
    return;
  }

  const agentStop = { usage: agentUsageOf(agentIdentifier, UNKNOWN_AGENT, readStringField(input, 'label'), 0, usage), briefText: prompt };
  await recordInTheTracker(commandArguments, context, COPILOT_REPORT_PREFIX, repositoryRoot, [agentStop], 'skipped');
}

/** The extension names only the session, so the repository root still arrives on standard input. */
export async function reconcileCopilotSession(commandArguments: ArgumentParser, context: CommandContext, sessionIdentifier: string): Promise<void> {
  const reconcileInput = await repositoryRootFromInput(context);
  if (reconcileInput === undefined) return;

  const eventsPath = sessionEventsPathOf(context.homeDirectory, sessionIdentifier);
  if (eventsPath === undefined) {
    context.standardError(`${COPILOT_REPORT_PREFIX} "${sessionIdentifier}" is not a session id, so ${NOTHING_RECORDED}.`);
    return;
  }
  const eventsText = sessionEventsTextAt(eventsPath);
  if (eventsText === undefined) {
    context.standardError(`${COPILOT_REPORT_PREFIX} the session events at ${eventsPath} could not be read, so ${NOTHING_RECORDED}.`);
    return;
  }

  const reading = readCopilotSession(eventsText);
  if (reading.verdict === 'malformed') {
    context.standardError(`${COPILOT_REPORT_PREFIX} line ${reading.lineNumber} of ${eventsPath} is malformed, so ${NOTHING_RECORDED}.`);
    return;
  }
  if (reading.verdict === 'not-shut-down') {
    context.standardError(`${COPILOT_REPORT_PREFIX} the session at ${eventsPath} has not shut down yet, so ${NOTHING_RECORDED}.`);
    return;
  }

  const agentStops = reading.agents.filter((agent) => agent.usage.inputTokens > 0).map(sessionAgentStopOf);
  if (agentStops.length === 0) return;
  await recordInTheTracker(commandArguments, context, COPILOT_REPORT_PREFIX, reconcileInput.repositoryRoot, agentStops, 'skipped');
}
