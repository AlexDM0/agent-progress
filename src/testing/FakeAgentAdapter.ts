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
  | { readonly kind: 'print'; readonly line: string }
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

export const FAKE_AGENT_VENDOR = 'fake-agent';

/** What a session the runner launches under the fake-agent switch plays: it starts, reports nothing and exits. */
export const DEFAULT_FAKE_AGENT_STEPS: readonly FakeAgentStep[] = Object.freeze([
  { kind: 'print', line: fakeStartedLine('fake-session') },
  { kind: 'exit', code: 0 },
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
