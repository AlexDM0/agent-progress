/** What the agents building and reviewing a ticket run on: the two vocabularies, and the one default pair a ticket overrides. */
import type { AgentEffort, AgentModel } from '../@types/Ticket.ts';

// Both are tiers that mean the same on every agent host, from lightest to heaviest; a host adapter maps each to its own model id and effort.
export const AGENT_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const;

export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const DEFAULT_AGENT_MODEL: AgentModel = 'opus';

export const DEFAULT_AGENT_EFFORT: AgentEffort = 'medium';
