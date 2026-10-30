/**
 * A job's live facts from its Watcher event log. What matters: `toolCalls` counts only top-level `tool-call` events, each subagent (by
 * `parentToolUseId`) keeps its own count and last call, `toolCallsWithSubagents` adds them up, `lastToolCall` is the newest call stamped
 * with its log entry's `at` and `running` until its result arrives, and `calls` stays the top-level API turns the budget is held against.
 * After a crash a subagent the log lost is rebuilt from the session's transcripts under a scratch home, never the real `~/.claude`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { AgentSessionEvent }                                      from '../../lib/agent-launch/AgentSessionEvent.ts';
import { transcriptFolderFor }                                         from '../../lib/claude-code/ClaudeTranscripts.ts';
import type { Job }                                                    from '../../lib/tracker-model/@types/Job.ts';
import { createEventLogWriter }                                        from '../../lib/watcher/EventLog.ts';
import { watcherFilesOf }                                              from '../../lib/watcher/WatcherFiles.ts';
import { WATCHER_PROTOCOL_OLDEST_SUPPORTED, WATCHER_PROTOCOL_VERSION } from '../../lib/watcher/constants/WatcherProtocol.ts';
import { DISPATCH_PROTOCOL }                                           from '../../shared/constants/DispatchProtocol.ts';
import { createScratchDirectory, removeScratchDirectory }              from '../../testing/ScratchWorkspace.ts';
import { JobLiveFactsReader }                                          from './JobLiveFactsReader.ts';
import { WatcherFleet }                                                from './WatcherFleet.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const EXAMPLE_JOB = { id: 'J1', kind: 'build', watcherInstance: 1 } as unknown as Readonly<Job>;

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

const EXAMPLE_SESSION_ID = 'session-example';

function scratchDirectoryFor(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

/** A Claude Code subagent transcript under a scratch home: a tool call answered, a second left open, and one API turn of 100 tokens. */
function writeSubagentTranscript(homeDirectory: string, workingDirectory: string, agentId: string, parentToolUseId: string): void {
  const subagentsFolder = join(transcriptFolderFor(workingDirectory, homeDirectory), EXAMPLE_SESSION_ID, 'subagents');
  mkdirSync(subagentsFolder, { recursive: true });
  const usage = {
    input_tokens: 40, output_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30
  };
  const lines = [
    { type: 'assistant', timestamp: '2026-10-29T13:00:01Z', message: { id: `${agentId}-message`, usage, content: [{ type: 'tool_use', id: `${agentId}-call-1`, name: 'Read' }] } },
    { type: 'user', timestamp: '2026-10-29T13:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: `${agentId}-call-1` }] } },
    { type: 'assistant', timestamp: '2026-10-29T13:00:03Z', message: { id: `${agentId}-message`, usage, content: [{ type: 'tool_use', id: `${agentId}-call-2`, name: 'Grep' }] } },
  ];
  writeFileSync(join(subagentsFolder, `agent-${agentId}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  writeFileSync(join(subagentsFolder, `agent-${agentId}.meta.json`), JSON.stringify({ toolUseId: parentToolUseId }));
}

/** A scratch tracker whose job J1 logged each event as one agent line, stamped in order; the mapper reads a line as the event itself. */
function liveFactsOfLoggedEvents(
  events: readonly AgentSessionEvent[],
  watcherProtocol: number | null = null,
  session: { homeDirectory: string; workingDirectory: string } | null = null,
) {
  const trackerDirectory = scratchDirectoryFor('live-facts');
  const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, EXAMPLE_JOB.id);
  mkdirSync(jobFolder, { recursive: true });
  if (watcherProtocol !== null) writeFileSync(watcherFilesOf(jobFolder, 1).watcherRecordPath, JSON.stringify({ protocolVersion: watcherProtocol }));
  let second = 0;
  const writer = createEventLogWriter(watcherFilesOf(jobFolder, 1).eventLogPath, () => {
    second += 1;
    return `2026-10-29T12:00:${String(second).padStart(2, '0')}Z`;
  });
  for (const event of events) writer.append('agent', JSON.stringify(event));
  writer.syncAndClose();
  const homeDirectory = session?.homeDirectory ?? scratchDirectoryFor('live-facts-home');
  if (session !== null) writeFileSync(watcherFilesOf(jobFolder, 1).launchPath, JSON.stringify({ workingDirectory: session.workingDirectory }));
  return JobLiveFactsReader.liveFactsOf(trackerDirectory, EXAMPLE_JOB, (line) => [JSON.parse(line) as AgentSessionEvent], { homeDirectory, sessionId: EXAMPLE_SESSION_ID });
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
    expect(facts.subagents).toEqual([{
      parentToolUseId: 'call-2', toolCalls: 3, lastToolCall: { toolName: 'Bash', startedAt: '2026-10-29T12:00:10Z', running: true }, tokens: 15
    }]);
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

  test('a subagent that only spoke still gets its row and tokens', () => {
    expect(liveFactsOfLoggedEvents([assistantTurn('message-1', 'call-9')]).subagents).toEqual([{
      parentToolUseId: 'call-9', toolCalls: 0, lastToolCall: null, tokens: 15
    }]);
  });

  test('after a crash the event log lost its subagents, the session\'s two subagent transcripts list both with their tallies, added to the totals', () => {
    const homeDirectory    = scratchDirectoryFor('live-facts-home');
    const workingDirectory = '/example/worktrees/ticket-1';
    writeSubagentTranscript(homeDirectory, workingDirectory, 'alpha', 'call-2');
    writeSubagentTranscript(homeDirectory, workingDirectory, 'beta', 'call-3');
    const facts = liveFactsOfLoggedEvents([
      assistantTurn('message-1', null),
      toolCall('call-2', 'Agent', null),
      toolCall('call-3', 'Agent', null),
    ], null, { homeDirectory, workingDirectory });
    expect(facts.subagents).toEqual([
      {
        parentToolUseId: 'call-2', toolCalls: 2, lastToolCall: { toolName: 'Grep', startedAt: '2026-10-29T13:00:03Z', running: true }, tokens: 100
      },
      {
        parentToolUseId: 'call-3', toolCalls: 2, lastToolCall: { toolName: 'Grep', startedAt: '2026-10-29T13:00:03Z', running: true }, tokens: 100
      },
    ]);
    expect(facts.toolCalls).toBe(2);
    expect(facts.toolCallsWithSubagents).toBe(6);
    expect(facts.tokens).toBe(215);
    expect(facts.calls).toBe(1);
  });

  test('a subagent the event log holds is read from the log alone, and only the one it lost comes from its transcript', () => {
    const homeDirectory    = scratchDirectoryFor('live-facts-home');
    const workingDirectory = '/example/worktrees/ticket-1';
    writeSubagentTranscript(homeDirectory, workingDirectory, 'alpha', 'call-2');
    writeSubagentTranscript(homeDirectory, workingDirectory, 'beta', 'call-3');
    const facts = liveFactsOfLoggedEvents([
      toolCall('call-2', 'Agent', null),
      assistantTurn('message-2', 'call-2'),
      toolCall('sub-1', 'Bash', 'call-2'),
    ], null, { homeDirectory, workingDirectory });
    expect(facts.subagents.map((subagent) => [subagent.parentToolUseId, subagent.toolCalls, subagent.tokens])).toEqual([['call-2', 1, 15], ['call-3', 2, 100]]);
    expect(facts.toolCallsWithSubagents).toBe(4);
  });

  test('the Watcher protocol comes from the newest instance\'s record, a protocol below the window reads watch-only, and no record reads null', () => {
    expect(liveFactsOfLoggedEvents([], WATCHER_PROTOCOL_VERSION)).toMatchObject({ watcherProtocol: WATCHER_PROTOCOL_VERSION, watchOnly: false });
    expect(liveFactsOfLoggedEvents([], WATCHER_PROTOCOL_OLDEST_SUPPORTED - 1)).toMatchObject({ watcherProtocol: WATCHER_PROTOCOL_OLDEST_SUPPORTED - 1, watchOnly: true });
    expect(liveFactsOfLoggedEvents([])).toMatchObject({ watcherProtocol: null, watchOnly: false });
  });
});
