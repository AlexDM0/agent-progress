/** The concurrency bounds. What callers rely on: a tracker that never set a limit reads one that the ceiling allows and that admits an agent. */
import { expect, test } from 'bun:test';

import { CONCURRENCY_LIMIT_CEILING_AGENTS, DEFAULT_CONCURRENCY_LIMIT_AGENTS } from './ConcurrencyLimits.ts';

// A default above the ceiling would be clamped on every read, and one below a single agent would never let a claim through.
test('the default limit lies between one agent and the ceiling', () => {
  expect(DEFAULT_CONCURRENCY_LIMIT_AGENTS).toBeGreaterThanOrEqual(1);
  expect(DEFAULT_CONCURRENCY_LIMIT_AGENTS).toBeLessThanOrEqual(CONCURRENCY_LIMIT_CEILING_AGENTS);
});
