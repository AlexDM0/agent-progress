/**
 * That the runner state tuple and its union in `src/lib/tracker-model/@types/TrackerProgress.ts` name the same two states, once each,
 * and that the default is one of them.
 */
import { expect, test } from 'bun:test';

import type { RunnerState }                    from '../@types/TrackerProgress.ts';
import type { TupleCoversTheUnion }            from '../testing/TupleCoversTheUnion.ts';
import { DEFAULT_RUNNER_STATE, RUNNER_STATES } from './RunnerStates.ts';

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const RUNNER_STATE_TUPLE_MATCHES_THE_UNION = RUNNER_STATES satisfies readonly RunnerState[];

const RUNNER_STATE_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<RunnerState, typeof RUNNER_STATES> = true;

test('every member of the tuple is a name the union also carries', () => {
  expect(RUNNER_STATE_TUPLE_MATCHES_THE_UNION.length).toBe(2);
});

// A stored runner state the tuple lacks makes the whole progress file unreadable, so a union member added without it must not pass.
test('every member of the union is a name the tuple also carries, and none appears twice', () => {
  expect(RUNNER_STATE_TUPLE_COVERS_THE_UNION).toBe(true);
  expect(new Set(RUNNER_STATES).size).toBe(RUNNER_STATES.length);
});

// A tracker that never set a state reads the default, and the validator only accepts states the tuple names.
test('the default runner state is one of the states', () => {
  expect(RUNNER_STATES).toContain(DEFAULT_RUNNER_STATE);
});
