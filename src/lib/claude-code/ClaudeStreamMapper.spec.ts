/**
 * The mapper is the Overseer's only reading of a Claude session, so each case replays a recorded 2.1.311 fixture
 * (`docs/development/overseer-claude-probe.md`) rather than a hand-written line: the start, a question the Overseer must deliver, the denials it
 * counts, the structured report it verifies, and the two rate-limit shapes of which only the top-level refusal may interrupt a job.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { AgentSessionEvent } from '../agent-launch/AgentSessionEvent.ts';
import { claudeStreamEventsOf }   from './ClaudeStreamMapper.ts';

const FIXTURES_FOLDER = join(import.meta.dir, 'testing', 'fixtures');

function eventsOfFixture(name: string): AgentSessionEvent[] {
  return readFileSync(join(FIXTURES_FOLDER, `${name}.stdout.jsonl`), 'utf8').split('\n').flatMap((line) => [...claudeStreamEventsOf(line)]);
}

function eventsOfKind<Kind extends AgentSessionEvent['kind']>(events: readonly AgentSessionEvent[], kind: Kind): Extract<AgentSessionEvent, { kind: Kind }>[] {
  return events.filter((event): event is Extract<AgentSessionEvent, { kind: Kind }> => event.kind === kind);
}

describe('a session that asks a question and reports (ask-user-question-live-answer)', () => {
  const events = eventsOfFixture('ask-user-question-live-answer');

  test('starts with the session id, the CLI version, the model and the tools', () => {
    const [started] = eventsOfKind(events, 'started');
    expect(started).toMatchObject({ sessionId: '7a1f0c52-0001-4000-8000-000000000001', vendorVersion: '2.1.311', model: 'claude-haiku-5-5' });
    expect(started?.tools).toContain('AskUserQuestion');
  });

  test('delivers the AskUserQuestion can_use_tool as a question under its request id, in the tool\'s own shape', () => {
    expect(eventsOfKind(events, 'question')).toEqual([{
      kind:      'question',
      requestId: 'd29eebff-9e62-470d-b2ec-522342cd5f98',
      questions: [{
        question:    'Which colour should the button be?',
        header:      'Button colour',
        multiSelect: false,
        options:     [{ label: 'Red', description: 'User picks Red for the button.' }, { label: 'Blue', description: 'User picks Blue for the button.' }],
      }],
    }]);
  });

  test('records each top-level assistant turn by message id with its usage, and each tool call', () => {
    const turns = eventsOfKind(events, 'assistant-turn');
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((turn) => turn.parentToolUseId === null && turn.messageId.startsWith('msg_') && turn.usage !== null)).toBe(true);
    expect(eventsOfKind(events, 'tool-call').map((call) => call.toolName)).toEqual(['AskUserQuestion', 'StructuredOutput']);
  });

  test('ends in one successful result carrying the structured report, the per-model totals and the context size', () => {
    const results = eventsOfKind(events, 'result');
    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBe(false);
    expect(results[0]?.structuredReport).toEqual({ colour: 'Blue' });
    expect(Object.keys(results[0]?.usageTotals?.byModel ?? {})).toEqual(['claude-haiku-5-5']);
    expect(results[0]?.contextTokens).toBeGreaterThan(0);
  });
});

describe('a session refused by its deny rules (permission-denials-under-deny-rules)', () => {
  test('reports each denied tool call listed on the result, ahead of the result', () => {
    const events = eventsOfFixture('permission-denials-under-deny-rules');
    expect(eventsOfKind(events, 'permission-denied').map((denial) => denial.toolName)).toEqual(['Write', 'Read', 'Write', 'Edit', 'Edit', 'Edit', 'Bash', 'Bash']);
    expect(events.at(-1)?.kind).toBe('result');
  });
});

describe('rate limits', () => {
  test('a top-level rejected limit refuses requests, and its error result has no report', () => {
    const events = eventsOfFixture('rate-limit-rejected');
    expect(eventsOfKind(events, 'usage-window')).toEqual([{
      kind: 'usage-window', window: 'five_hour', utilization: 1, resetsAt: new Date(1793142034000).toISOString(), status: 'rejected', requestsRefused: true,
    }]);
    expect(eventsOfKind(events, 'result')[0]).toMatchObject({ isError: true, structuredReport: null });
  });

  test('a warning on one window, another rejected under overage, refuses nothing', () => {
    const events = eventsOfFixture('rate-limit-window-rejected-under-allowed');
    expect(eventsOfKind(events, 'usage-window')).toEqual([{
      kind: 'usage-window', window: 'seven_day', utilization: 0.91, resetsAt: new Date(1793397634000).toISOString(), status: 'allowed_warning', requestsRefused: false,
    }]);
    expect(eventsOfKind(events, 'result')[0]?.isError).toBe(false);
  });
});

describe('a resumed session (resume-structured-output)', () => {
  test('keeps its session id and reports schema-valid output', () => {
    const events = eventsOfFixture('resume-structured-output');
    expect(eventsOfKind(events, 'started')[0]?.sessionId).toBe('7a1f0c52-0001-4000-8000-000000000001');
    expect(eventsOfKind(events, 'result')[0]?.structuredReport).toEqual({ colour: 'Blue' });
  });
});

describe('lines that are no event', () => {
  test('a non-JSON line, a JSON array, an unknown record type and a non-question permission request map to nothing', () => {
    expect(claudeStreamEventsOf('not json')).toEqual([]);
    expect(claudeStreamEventsOf('[1,2]')).toEqual([]);
    expect(claudeStreamEventsOf('{"type":"system","subtype":"task_summary"}')).toEqual([]);
    expect(claudeStreamEventsOf('{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{}}}')).toEqual([]);
  });

  test('a subagent\'s assistant turn keeps its parent tool call id', () => {
    const line = JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_parent', message: { id: 'msg_child', model: 'claude-haiku-5-5', content: [] } });
    expect(claudeStreamEventsOf(line)).toEqual([{
      kind: 'assistant-turn', messageId: 'msg_child', parentToolUseId: 'toolu_parent', model: 'claude-haiku-5-5', usage: null, text: ''
    }]);
  });

  test('a turn keeps its text and each tool call its id, and a user record\'s tool result names the call it answers', () => {
    const turnLine = JSON.stringify({
      type:               'assistant',
      parent_tool_use_id: null,
      message:            {
        id:      'msg_turn',
        model:   'claude-opus-5-5',
        content: [{ type: 'text', text: 'Reading it.' }, {
          type: 'tool_use', id: 'toolu_read', name: 'Read', input: {}
        }]
      },
    });
    expect(claudeStreamEventsOf(turnLine)).toEqual([
      {
        kind: 'assistant-turn', messageId: 'msg_turn', parentToolUseId: null, model: 'claude-opus-5-5', usage: null, text: 'Reading it.'
      },
      {
        kind: 'tool-call', toolUseId: 'toolu_read', toolName: 'Read', inputSummary: '{}', parentToolUseId: null
      },
    ]);
    const resultContent = [{ type: 'tool_result', tool_use_id: 'toolu_read', is_error: true }];
    const resultLine = JSON.stringify({ type: 'user', parent_tool_use_id: 'toolu_parent', message: { content: resultContent } });
    expect(claudeStreamEventsOf(resultLine)).toEqual([{
      kind: 'tool-result', toolUseId: 'toolu_read', parentToolUseId: 'toolu_parent', isError: true
    }]);
  });
});
