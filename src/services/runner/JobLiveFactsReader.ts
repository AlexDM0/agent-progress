/**
 * A job's live facts as the Overseer's API shows them, read from its Watcher event logs through the adapter's mapper: API turns against
 * the budget, tokens so far, and tool calls, the job's own and each subagent's by `parentToolUseId`. The stamps are only recorded and
 * shown: no Overseer decision reads them.
 */
import type { EventLogEntry }     from '../../lib/agent-host/EventLog.ts';
import type { AgentSessionEvent } from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { Job }               from '../../lib/tracker-model/@types/Job.ts';
import { HostFleet }              from './HostFleet.ts';
import { JobLaunch }              from './JobLaunch.ts';
import { LegacyHostReader }       from './LegacyHostReader.ts';

export interface LastToolCall {
  toolName:  string;
  /** The Watcher log entry's stamp; `null` for an entry written before stamps. */
  startedAt: string | null;
  /** True until the call's result arrives. */
  running:   boolean;
}

export interface SubagentLiveFacts {
  parentToolUseId: string;
  toolCalls:       number;
  lastToolCall:    LastToolCall | null;
  tokens:          number;
}

export interface WatcherFacts {
  /** The protocol the newest instance's Watcher record names; `null` before it wrote one. */
  watcherProtocol: number | null;
  /** A Watcher below the supported window: watched through its files alone. */
  watchOnly:       boolean;
}

export interface JobLiveFacts {
  jobId:                  string;
  /** API turns of the job's own session, the count its call budget is held against. */
  calls:                  number;
  /** `null` for a job no budget holds. */
  callBudget:             number | null;
  tokens:                 number;
  toolCalls:              number;
  lastToolCall:           LastToolCall | null;
  subagents:              SubagentLiveFacts[];
  toolCallsWithSubagents: number;
  watcherProtocol:        number | null;
  watchOnly:              boolean;
}

export interface StampedEvents {
  at:     string | null;
  events: readonly AgentSessionEvent[];
}

type JobLiveCounts = Omit<JobLiveFacts, 'jobId' | 'callBudget' | keyof WatcherFacts>;

const BUDGETED_JOB_KINDS: readonly string[] = ['build', 'review'];

interface ToolCallTally {
  toolCalls:         number;
  last:              { toolUseId: string; toolName: string; startedAt: string | null } | null;
  tokensByMessageId: Map<string, number>;
}

function emptyTally(): ToolCallTally {
  return { toolCalls: 0, last: null, tokensByMessageId: new Map() };
}

function summedTokensOf(tokensByMessageId: ReadonlyMap<string, number>): number {
  return [...tokensByMessageId.values()].reduce((sum, tokens) => sum + tokens, 0);
}

function lastToolCallOf(tally: ToolCallTally, answeredToolUseIds: ReadonlySet<string>): LastToolCall | null {
  if (tally.last === null) return null;
  return { toolName: tally.last.toolName, startedAt: tally.last.startedAt, running: !answeredToolUseIds.has(tally.last.toolUseId) };
}

function tokensOf(usage: Extract<AgentSessionEvent, { kind: 'assistant-turn' }>['usage']): number {
  if (usage === null) return 0;
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

/** Pure over the mapped events in log order, so a spec drives it without a Watcher. */
function liveCountsOf(stampedEvents: readonly StampedEvents[]): JobLiveCounts {
  const topLevelMessageIds = new Set<string>();
  const tokensByMessageId  = new Map<string, number>();
  const answeredToolUseIds = new Set<string>();
  const ownTally = emptyTally();
  const subagentTallies = new Map<string, ToolCallTally>();
  const tallyOf = (parentToolUseId: string | null): ToolCallTally => {
    if (parentToolUseId === null) return ownTally;
    const tally = subagentTallies.get(parentToolUseId) ?? emptyTally();
    subagentTallies.set(parentToolUseId, tally);
    return tally;
  };
  for (const { at, events } of stampedEvents) {
    for (const event of events) {
      if (event.kind === 'assistant-turn') {
        if (event.parentToolUseId === null) topLevelMessageIds.add(event.messageId);
        tokensByMessageId.set(event.messageId, tokensOf(event.usage));
        tallyOf(event.parentToolUseId).tokensByMessageId.set(event.messageId, tokensOf(event.usage));
      }
      if (event.kind === 'tool-result') answeredToolUseIds.add(event.toolUseId);
      if (event.kind !== 'tool-call') continue;
      const tally = tallyOf(event.parentToolUseId);
      tally.toolCalls += 1;
      tally.last = { toolUseId: event.toolUseId, toolName: event.toolName, startedAt: at };
    }
  }
  const subagents = [...subagentTallies].map(([parentToolUseId, tally]): SubagentLiveFacts => ({
    parentToolUseId, toolCalls: tally.toolCalls, lastToolCall: lastToolCallOf(tally, answeredToolUseIds), tokens: summedTokensOf(tally.tokensByMessageId)
  }));
  return {
    calls:                  topLevelMessageIds.size,
    tokens:                 summedTokensOf(tokensByMessageId),
    toolCalls:              ownTally.toolCalls,
    lastToolCall:           lastToolCallOf(ownTally, answeredToolUseIds),
    subagents,
    toolCallsWithSubagents: subagents.reduce((sum, subagent) => sum + subagent.toolCalls, ownTally.toolCalls),
  };
}

/** Every agent line of every instance in order; a malformed log contributes nothing rather than failing the state. */
function agentEntriesOf(trackerDirectory: string, job: Readonly<Job>): EventLogEntry[] {
  const jobFolder = HostFleet.jobFolderOf(trackerDirectory, job.id);
  const entries: EventLogEntry[] = [];
  for (let instance = 1; instance <= job.hostInstance; instance += 1) {
    const read = HostFleet.eventsAfter(jobFolder, instance, 0);
    if (read !== 'malformed') entries.push(...read.filter((entry) => entry.origin === 'agent'));
  }
  return entries;
}

function watcherFactsOf(trackerDirectory: string, job: Readonly<Job>): WatcherFacts {
  const record = HostFleet.hostRecordOf(HostFleet.jobFolderOf(trackerDirectory, job.id), job.hostInstance);
  return { watcherProtocol: record?.protocolVersion ?? null, watchOnly: LegacyHostReader.attachmentOf(record) === 'legacy-host' };
}

function liveFactsOf(trackerDirectory: string, job: Readonly<Job>, eventsOf: (line: string) => readonly AgentSessionEvent[]): JobLiveFacts {
  const stampedEvents = agentEntriesOf(trackerDirectory, job).map((entry) => ({ at: entry.at ?? null, events: eventsOf(entry.line) }));
  return {
    jobId:      job.id,
    callBudget: BUDGETED_JOB_KINDS.includes(job.kind) ? JobLaunch.callBudgetOf(job) : null,
    ...liveCountsOf(stampedEvents),
    ...watcherFactsOf(trackerDirectory, job),
  };
}

export const JobLiveFactsReader = Object.freeze({ liveCountsOf, liveFactsOf });
