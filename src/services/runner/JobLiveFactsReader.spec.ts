/**
 * A job's live facts from its Watcher event log. What matters: `toolCalls` counts only top-level `tool-call` events, each subagent (by
 * `parentToolUseId`) keeps its own count and last call, `toolCallsWithSubagents` adds them up, `lastToolCall` is the newest call stamped
 * with its log entry's `at` and `running` until its result arrives, and `calls` stays the top-level API turns the budget is held against.
 */
import { mkdirSync } from 'node:fs';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createEventLogWriter }                           from '../../lib/agent-host/EventLog.ts';
import { hostFilesOf }                                    from '../../lib/agent-host/HostFiles.ts';
import type { AgentSessionEvent }                         from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { Job }                                       from '../../lib/tracker-model/@types/Job.ts';
import { DISPATCH_PROTOCOL }                              from '../../shared/constants/DispatchProtocol.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { HostFleet }                                      from './HostFleet.ts';
import { JobLiveFactsReader }                             from './JobLiveFactsReader.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const EXAMPLE_JOB = { id: 'J1', kind: 'build', hostInstance: 1 } as unknown as Readonly<Job>;

function toolCall(toolUseId: string, toolName: string, parentToolUseId: string | null): AgentSessionEvent {
  return {
    kind: 'tool-call', toolUseId, toolName, inputSummary: toolName, parentToolUseId
  };
}

function toolResult(toolUseId: string, parentToolUseId: string | null): AgentSessionEvent {
  return {
    kind: 'tool-result', toolUseId, parentToolUseId, isError: false
  };
}

function assistantTurn(messageId: string, parentToolUseId: string | null): AgentSessionEvent {
  return {
    kind:  'assistant-turn',
    messageId,
    parentToolUseId,
    model: 'example-model',
    usage: {
      inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0
    },
    text: '',
  };
}

/** A scratch tracker whose job J1 logged each event as one agent line, stamped in order; the mapper reads a line as the event itself. */
function liveFactsOfLoggedEvents(events: readonly AgentSessionEvent[]) {
  const trackerDirectory = createScratchDirectory('live-facts');
  scratchDirectories.push(trackerDirectory);
  const jobFolder = HostFleet.jobFolderOf(trackerDirectory, EXAMPLE_JOB.id);
  mkdirSync(jobFolder, { recursive: true });
  let second = 0;
  const writer = createEventLogWriter(hostFilesOf(jobFolder, 1).eventLogPath, () => {
    second += 1;
    return `2026-10-29T12:00:${String(second).padStart(2, '0')}Z`;
  });
  for (const event of events) writer.append('agent', JSON.stringify(event));
  writer.syncAndClose();
  return JobLiveFactsReader.liveFactsOf(trackerDirectory, EXAMPLE_JOB, (line) => [JSON.parse(line) as AgentSessionEvent]);
}

describe('JobLiveFactsReader', () => {
  test('two top-level and three subagent tool calls count 2, 3 and 5, and the open call reads running with its log stamp', () => {
    const facts = liveFactsOfLoggedEvents([
      assistantTurn('message-1', null),
      toolCall('call-1', 'Read', null),
      toolResult('call-1', null),
      toolCall('call-2', 'Agent', null),
      assistantTurn('message-2', 'call-2'),
      toolCall('sub-1', 'Grep', 'call-2'),
      toolResult('sub-1', 'call-2'),
      toolCall('sub-2', 'Read', 'call-2'),
      toolResult('sub-2', 'call-2'),
      toolCall('sub-3', 'Bash', 'call-2'),
    ]);
    expect(facts.toolCalls).toBe(2);
    expect(facts.subagents).toEqual([{ parentToolUseId: 'call-2', toolCalls: 3, lastToolCall: { toolName: 'Bash', startedAt: '2026-10-29T12:00:10Z', running: true } }]);
    expect(facts.toolCallsWithSubagents).toBe(5);
    expect(facts.lastToolCall).toEqual({ toolName: 'Agent', startedAt: '2026-10-29T12:00:04Z', running: true });
    expect(facts.calls).toBe(1);
    expect(facts.callBudget).toBe(DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET);
    expect(facts.tokens).toBe(30);
  });

  test('a call whose result arrived reads not running, and a job that called no tool has no last call', () => {
    expect(liveFactsOfLoggedEvents([toolCall('call-1', 'Read', null), toolResult('call-1', null)]).lastToolCall)
      .toEqual({ toolName: 'Read', startedAt: '2026-10-29T12:00:01Z', running: false });
    const quiet = liveFactsOfLoggedEvents([assistantTurn('message-1', null)]);
    expect(quiet.lastToolCall).toBeNull();
    expect(quiet.toolCalls).toBe(0);
    expect(quiet.subagents).toEqual([]);
    expect(quiet.toolCallsWithSubagents).toBe(0);
  });
});
