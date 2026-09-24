/** What the agents building and reviewing a ticket run on: the two vocabularies, and the one default pair a ticket overrides. */
import type { AgentEffort, AgentModel } from './Types.ts';

export const AGENT_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const;

export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const DEFAULT_AGENT_MODEL: AgentModel = 'opus';

export const DEFAULT_AGENT_EFFORT: AgentEffort = 'medium';

/** A membership test, not a record lookup: argv can spell `constructor`. */
export function agentModelIsKnown(text: string): text is AgentModel {
  return (AGENT_MODELS as readonly string[]).includes(text);
}

export function agentEffortIsKnown(text: string): text is AgentEffort {
  return (AGENT_EFFORTS as readonly string[]).includes(text);
}

export function agentModelOf(ticket: { model?: AgentModel }): AgentModel {
  return ticket.model ?? DEFAULT_AGENT_MODEL;
}

export function agentEffortOf(ticket: { effort?: AgentEffort }): AgentEffort {
  return ticket.effort ?? DEFAULT_AGENT_EFFORT;
}
