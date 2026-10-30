/**
 * A launcher-port adapter whose session is the fake child `src/testing/fake-agent/FakeAgentChild.ts`: it plays a scripted list of
 * steps, printing Claude-shaped stream-json lines, waiting for stdin lines, exiting or crashing, so runner, host and crash specs drive a
 * session without a vendor. Its lines are read and written as the Claude adapter's.
 */
import { join } from 'node:path';

import type { AgentAdapter }                             from '../lib/agent-launch/AgentAdapter.ts';
import type { AgentLaunchPlan }                          from '../lib/agent-launch/AgentLaunchPlan.ts';
import type { AgentLaunchRequest }                       from '../lib/agent-launch/AgentLaunchRequest.ts';
import type { AgentQuestion }                            from '../lib/agent-launch/AgentSessionEvent.ts';
import { CLAUDE_CODE_CAPABILITIES, CLAUDE_STREAM_LINES } from '../lib/claude-code/ClaudeStreamLines.ts';

export type FakeAgentStep =
  /** `{{HEAD}}` in the line is replaced by the commit HEAD of the session's working directory is on. */
  | { readonly kind: 'print'; readonly line: string }
  /** Runs `/bin/sh -c <command>` in the working directory, as a session's tool call would. */
  | { readonly kind: 'shell'; readonly command: string }
  /** Waits for the next stdin line; a closed stdin ends the session at exit 0. */
  | { readonly kind: 'await-line' }
  | { readonly kind: 'exit'; readonly code: number }
  | { readonly kind: 'crash' };

export const FAKE_AGENT_CHILD_PATH = join(import.meta.dir, 'fake-agent', 'FakeAgentChild.ts');

const SCENARIO_FILE_NAME = 'fake-agent-scenario.json';

export function fakeStartedLine(sessionId: string): string {
  return JSON.stringify({
    type: 'system', subtype: 'init', session_id: sessionId, claude_code_version: 'fake', model: 'fake-model', tools: ['AskUserQuestion']
  });
}

export function fakeQuestionLine(requestId: string, questions: readonly AgentQuestion[]): string {
  return JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions } } });
}

export function fakeResultLine(structuredReport: unknown): string {
  return JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, structured_output: structuredReport, permission_denials: []
  });
}

export const FAKE_HEAD_PLACEHOLDER = '{{HEAD}}';

export function fakeAssistantTurnLine(messageId: string): string {
  return JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: messageId, model: 'fake-model', content: [] } });
}

export const FAKE_AGENT_VENDOR = 'fake-agent';

/** What a session the runner launches under the fake-agent switch plays: it starts, reports nothing and exits. */
export const DEFAULT_FAKE_AGENT_STEPS: readonly FakeAgentStep[] = Object.freeze([
  { kind: 'print', line: fakeStartedLine('fake-session') },
  { kind: 'exit', code: 0 },
]);

/** A session that starts and keeps working until its stdin closes, so a board shown with it has its agents running. */
export const WORKING_FAKE_AGENT_STEPS: readonly FakeAgentStep[] = Object.freeze([
  { kind: 'print', line: fakeStartedLine('fake-session') },
  { kind: 'await-line' },
]);

export function fakeAgentAdapter(steps: readonly FakeAgentStep[] = DEFAULT_FAKE_AGENT_STEPS): AgentAdapter {
  return {
    vendor:       FAKE_AGENT_VENDOR,
    capabilities: CLAUDE_CODE_CAPABILITIES,
    planOf(request: AgentLaunchRequest): AgentLaunchPlan {
      const scenarioPath = join(request.jobFilesDirectory, SCENARIO_FILE_NAME);
      return {
        argv:            [process.execPath, FAKE_AGENT_CHILD_PATH, scenarioPath],
        environment:     request.environment,
        files:           [{ path: scenarioPath, text: JSON.stringify(steps) }],
        standingReplies: [],
      };
    },
    sessionIdOf: (scope, jobId) => `fake-${scope}-${jobId}`,
    ...CLAUDE_STREAM_LINES,
  };
}
