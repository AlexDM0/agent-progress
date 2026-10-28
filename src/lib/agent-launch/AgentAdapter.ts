/**
 * The launcher port: what a coding-agent vendor's adapter does for a host that knows no vendor. It renders a launch plan the host executes,
 * maps each stdout line the session prints to events, and writes the lines a host sends the session. The package depends on nothing else.
 */
import type { AgentLaunchPlan }                  from './AgentLaunchPlan.ts';
import type { AgentLaunchRequest }               from './AgentLaunchRequest.ts';
import type { AgentQuestion, AgentSessionEvent } from './AgentSessionEvent.ts';

export interface AgentCapabilities {
  readonly chatTurns:     boolean;
  readonly questions:     boolean;
  readonly resume:        boolean;
  readonly reportChannel: 'schema';
  readonly usage:         'tokens' | 'none';
}

export interface AgentAdapter {
  readonly vendor:       string;
  readonly capabilities: AgentCapabilities;
  planOf(request: AgentLaunchRequest): AgentLaunchPlan;
  /** One stdout line, mapped; a line the adapter does not recognise maps to no event. */
  eventsOf(line: string): readonly AgentSessionEvent[];
  chatLineOf(text: string): string;
  /** `questions` are the ones the `question` event carried, which a vendor may need echoed beside the answers. */
  answerLineOf(requestId: string, questions: readonly AgentQuestion[], answers: Readonly<Record<string, string>>): string;
  interruptLineOf(): string;
}
