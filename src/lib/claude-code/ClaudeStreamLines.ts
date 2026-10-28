/**
 * The stream-json lines Claude Code reads and writes once a session runs: the events read from its stdout and each line a host sends its
 * stdin, apart from the command line that starts it, so a scripted session speaking the same lines needs no launch plan of Claude's.
 */
import type { AgentAdapter, AgentCapabilities } from '../agent-launch/AgentAdapter.ts';
import type { AgentQuestion }                   from '../agent-launch/AgentSessionEvent.ts';
import { claudeStreamEventsOf }                 from './ClaudeStreamMapper.ts';

const INTERRUPT_REQUEST_ID = 'interrupt';

function chatLineOf(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}

/** The tool's input is echoed whole beside the answers, as the session's own question carried it. */
function answerLineOf(requestId: string, questions: readonly AgentQuestion[], answers: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    type:     'control_response',
    response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow', updatedInput: { questions, answers } } },
  });
}

function interruptLineOf(): string {
  return JSON.stringify({ type: 'control_request', request_id: INTERRUPT_REQUEST_ID, request: { subtype: 'interrupt' } });
}

export const CLAUDE_CODE_CAPABILITIES: AgentCapabilities = Object.freeze({
  chatTurns: true, questions: true, resume: true, reportChannel: 'schema', usage: 'tokens'
});

export const CLAUDE_STREAM_LINES: Pick<AgentAdapter, 'eventsOf' | 'chatLineOf' | 'answerLineOf' | 'interruptLineOf'> = Object.freeze({
  eventsOf: claudeStreamEventsOf,
  chatLineOf,
  answerLineOf,
  interruptLineOf,
});
