/**
 * The agent vocabularies and their defaults. What callers rely on: the tuples match the unions in `lib/constants/Types.ts`, the guards
 * accept exactly the tuple, and an absent key resolves to the one default pair rather than to something each reader decides.
 */
import { expect, test } from 'bun:test';

import {
  AGENT_EFFORTS,
  AGENT_MODELS,
  DEFAULT_AGENT_EFFORT,
  DEFAULT_AGENT_MODEL,
  agentEffortIsKnown,
  agentEffortOf,
  agentModelIsKnown,
  agentModelOf
}                                       from './AgentSettings';
import type { AgentEffort, AgentModel } from './Types';

const MODEL_TUPLE_MATCHES_THE_UNION  = AGENT_MODELS satisfies readonly AgentModel[];
const EFFORT_TUPLE_MATCHES_THE_UNION = AGENT_EFFORTS satisfies readonly AgentEffort[];

test('the vocabularies are the four model aliases and the five effort levels Claude Code documents', () => {
  expect([...MODEL_TUPLE_MATCHES_THE_UNION]).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  expect([...EFFORT_TUPLE_MATCHES_THE_UNION]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
});

test('builders and reviewers default to opus on medium effort', () => {
  expect(DEFAULT_AGENT_MODEL).toBe('opus');
  expect(DEFAULT_AGENT_EFFORT).toBe('medium');
});

// argv reaches these guards, so an inherited property name and a near miss must both be refused.
test('the guards accept every tuple member and nothing that merely looks like one', () => {
  for (const model of AGENT_MODELS) expect(agentModelIsKnown(model)).toBe(true);
  for (const effort of AGENT_EFFORTS) expect(agentEffortIsKnown(effort)).toBe(true);
  for (const impostor of ['Opus', 'claude-opus-5-5', 'inherit', 'constructor', '']) expect(agentModelIsKnown(impostor)).toBe(false);
  for (const impostor of ['Medium', 'extra-high', 'constructor', '']) expect(agentEffortIsKnown(impostor)).toBe(false);
});

test('an absent key resolves to the default and a present one is returned as written', () => {
  expect(agentModelOf({})).toBe('opus');
  expect(agentEffortOf({})).toBe('medium');
  expect(agentModelOf({ model: 'sonnet' })).toBe('sonnet');
  expect(agentEffortOf({ effort: 'xhigh' })).toBe('xhigh');
});
