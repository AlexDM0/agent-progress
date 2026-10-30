/**
 * That the Overseer state tuple and its union in `src/lib/tracker-model/@types/TrackerProgress.ts` name the same two states, once each,
 * and that the default is one of them.
 */
import { expect, test } from 'bun:test';

import type { OverseerState }                      from '../@types/TrackerProgress.ts';
import type { TupleCoversTheUnion }                from '../testing/TupleCoversTheUnion.ts';
import { DEFAULT_OVERSEER_STATE, OVERSEER_STATES } from './OverseerStates.ts';

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const OVERSEER_STATE_TUPLE_MATCHES_THE_UNION = OVERSEER_STATES satisfies readonly OverseerState[];

const OVERSEER_STATE_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<OverseerState, typeof OVERSEER_STATES> = true;

test('every member of the tuple is a name the union also carries', () => {
  expect(OVERSEER_STATE_TUPLE_MATCHES_THE_UNION.length).toBe(2);
});

// A stored Overseer state the tuple lacks makes the whole progress file unreadable, so a union member added without it must not pass.
test('every member of the union is a name the tuple also carries, and none appears twice', () => {
  expect(OVERSEER_STATE_TUPLE_COVERS_THE_UNION).toBe(true);
  expect(new Set(OVERSEER_STATES).size).toBe(OVERSEER_STATES.length);
});

// A tracker that never set a state reads the default, and the validator only accepts states the tuple names.
test('the default Overseer state is one of the states', () => {
  expect(OVERSEER_STATES).toContain(DEFAULT_OVERSEER_STATE);
});
