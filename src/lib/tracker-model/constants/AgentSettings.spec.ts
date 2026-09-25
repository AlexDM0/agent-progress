/**
 * The agent vocabularies and their defaults. What callers rely on: the tuples match the unions in
 * `src/lib/tracker-model/@types/Ticket.ts`, and there is one default pair rather than something each reader decides.
 */
import { expect, test } from 'bun:test';

import type { AgentEffort, AgentModel } from '../@types/Ticket';
import {
  AGENT_EFFORTS,
  AGENT_MODELS,
  DEFAULT_AGENT_EFFORT,
  DEFAULT_AGENT_MODEL
}                                       from './AgentSettings';

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
