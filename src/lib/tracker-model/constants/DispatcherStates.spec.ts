/** That the dispatcher state tuple and its union in `src/lib/tracker-model/@types/ProgressFile.ts` name the same three states, once each. */
import { expect, test } from 'bun:test';

import type { DispatcherState }     from '../@types/ProgressFile';
import { DISPATCHER_STATES }        from './DispatcherStates';
import type { TupleCoversTheUnion } from './TupleCoversTheUnion';

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const DISPATCHER_STATE_TUPLE_MATCHES_THE_UNION = DISPATCHER_STATES satisfies readonly DispatcherState[];

const DISPATCHER_STATE_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<DispatcherState, typeof DISPATCHER_STATES> = true;

test('every member of the tuple is a name the union also carries', () => {
  expect(DISPATCHER_STATE_TUPLE_MATCHES_THE_UNION.length).toBe(3);
});

// A stored dispatcher state the tuple lacks makes the whole progress file unreadable, so a union member added without it must not pass.
test('every member of the union is a name the tuple also carries, and none appears twice', () => {
  expect(DISPATCHER_STATE_TUPLE_COVERS_THE_UNION).toBe(true);
  expect(new Set(DISPATCHER_STATES).size).toBe(DISPATCHER_STATES.length);
});
