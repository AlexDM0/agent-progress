/**
 * A session's subagent transcripts tallied as the live facts tally the event log. What matters: a call repeated across a turn's lines
 * counts once and runs until its result, a half-written last line costs nothing, a subagent is keyed by its `.meta.json` parent call or
 * else its agent id, and only this session's transcripts are read, a workflow run's among them, under a scratch home.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { transcriptFolderFor }                            from '../../lib/claude-code/ClaudeTranscripts.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { ClaudeTranscripts }                              from './ClaudeTranscripts.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const WORKING_DIRECTORY = '/example/worktrees/ticket-1';

function transcriptLines(...lines: readonly object[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

function toolUseLine(messageId: string, toolUseId: string, toolName: string, timestamp: string): object {
  return { type: 'assistant', timestamp, message: { id: messageId, usage: { input_tokens: 7, output_tokens: 3 }, content: [{ type: 'tool_use', id: toolUseId, name: toolName }] } };
}

function toolResultLine(toolUseId: string): object {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId }] } };
}

describe('ClaudeTranscripts.subagentFactsOfTranscript', () => {
  test('a call repeated across lines counts once, the newest call is the last, and it stops running when its result arrives', () => {
    const text = transcriptLines(
      toolUseLine('message-1', 'call-1', 'Read', '2026-10-29T13:00:01Z'),
      toolUseLine('message-1', 'call-1', 'Read', '2026-10-29T13:00:01Z'),
      toolResultLine('call-1'),
      toolUseLine('message-2', 'call-2', 'Bash', '2026-10-29T13:00:05Z'),
      toolResultLine('call-2'),
    );
    expect(ClaudeTranscripts.subagentFactsOfTranscript('parent-1', text)).toEqual({
      parentToolUseId: 'parent-1', toolCalls: 2, lastToolCall: { toolName: 'Bash', startedAt: '2026-10-29T13:00:05Z', running: false }, tokens: 20
    });
  });

  test('a half-written last line and a transcript with no call read as what they hold', () => {
    const text = `${transcriptLines(toolUseLine('message-1', 'call-1', 'Read', '2026-10-29T13:00:01Z'))}\n{"type":"assis`;
    expect(ClaudeTranscripts.subagentFactsOfTranscript('parent-1', text).toolCalls).toBe(1);
    expect(ClaudeTranscripts.subagentFactsOfTranscript('parent-1', '')).toEqual({
      parentToolUseId: 'parent-1', toolCalls: 0, lastToolCall: null, tokens: 0
    });
  });
});

describe('ClaudeTranscripts.subagentFactsOf', () => {
  function sessionFolderUnderScratchHome(sessionId: string): { homeDirectory: string; subagentsFolder: string } {
    const homeDirectory = createScratchDirectory('claude-transcripts-home');
    scratchDirectories.push(homeDirectory);
    return { homeDirectory, subagentsFolder: join(transcriptFolderFor(WORKING_DIRECTORY, homeDirectory), sessionId, 'subagents') };
  }

  function writeAgent(folder: string, agentId: string, parentToolUseId: string | null): void {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `agent-${agentId}.jsonl`), transcriptLines(toolUseLine(`${agentId}-message`, `${agentId}-call`, 'Grep', '2026-10-29T13:00:01Z')));
    if (parentToolUseId !== null) writeFileSync(join(folder, `agent-${agentId}.meta.json`), JSON.stringify({ toolUseId: parentToolUseId }));
  }

  test('reads this session\'s subagents and workflow agents, keyed by parent call or agent id, skipping the parent calls already tallied', () => {
    const { homeDirectory, subagentsFolder } = sessionFolderUnderScratchHome('session-1');
    writeAgent(subagentsFolder, 'alpha', 'call-2');
    writeAgent(subagentsFolder, 'beta', null);
    writeAgent(subagentsFolder, 'gamma', 'call-4');
    writeAgent(join(subagentsFolder, 'workflows', 'run-1'), 'delta', 'call-5');
    writeAgent(join(subagentsFolder, '..', '..', 'session-2', 'subagents'), 'epsilon', 'call-6');
    const facts = ClaudeTranscripts.subagentFactsOf({ homeDirectory, workingDirectory: WORKING_DIRECTORY, sessionId: 'session-1' }, new Set(['call-4']));
    expect(facts.map((subagent) => subagent.parentToolUseId)).toEqual(['call-2', 'beta', 'call-5']);
  });

  test('a session that left no transcripts has no subagents', () => {
    const { homeDirectory } = sessionFolderUnderScratchHome('session-1');
    expect(ClaudeTranscripts.subagentFactsOf({ homeDirectory, workingDirectory: WORKING_DIRECTORY, sessionId: 'session-1' }, new Set())).toEqual([]);
  });
});
