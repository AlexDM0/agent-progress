/**
 * That the status tuples and the unions in `src/lib/tracker-model/@types/` still describe the same ladders, that each
 * ladder holds its states in order and once, and that a ticket status crossing into the task ladder keeps its meaning.
 */
import { expect, test } from 'bun:test';

import type { TaskStatus }                                               from '../@types/Task';
import type { TicketStatus }                                             from '../@types/Ticket';
import { VocabularyUtil }                                                from '../utils/VocabularyUtil';
import { TASK_STATUSES, TASK_STATUS_FOR_TICKET_STATUS, TICKET_STATUSES } from './Statuses';

const { taskStatusIsKnown } = VocabularyUtil;

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const TASK_STATUS_TUPLE_MATCHES_THE_UNION = TASK_STATUSES satisfies readonly TaskStatus[];
const TICKET_STATUS_TUPLE_MATCHES_THE_UNION = TICKET_STATUSES satisfies readonly TicketStatus[];

/** The other direction: a union member the tuple lacks leaves a remainder that is not `never`, and `true` then fails `bun run typecheck`. */
type TupleCoversTheUnion<Union, Tuple extends readonly unknown[]> = [Exclude<Union, Tuple[number]>] extends [never] ? true : false;

const TASK_STATUS_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<TaskStatus, typeof TASK_STATUSES> = true;
const TICKET_STATUS_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<TicketStatus, typeof TICKET_STATUSES> = true;

test('every member of each status tuple is a name the matching union also carries', () => {
  expect(TASK_STATUS_TUPLE_MATCHES_THE_UNION.length).toBeGreaterThanOrEqual(7);
  expect(TICKET_STATUS_TUPLE_MATCHES_THE_UNION.length).toBeGreaterThanOrEqual(6);
});

// A stored status the tuple lacks makes the whole file unreadable, so a union member added without it must not pass.
test('every member of each status union is a name the matching tuple also carries', () => {
  expect([TASK_STATUS_TUPLE_COVERS_THE_UNION, TICKET_STATUS_TUPLE_COVERS_THE_UNION]).toEqual([true, true]);
});

test('the task ladder carries paused between running and finished, and no ticket status reaches it', () => {
  expect(TASK_STATUSES.indexOf('paused')).toBe(TASK_STATUSES.indexOf('running') + 1);
  expect(TASK_STATUSES.indexOf('finished')).toBe(TASK_STATUSES.indexOf('paused') + 1);
  expect(taskStatusIsKnown('paused')).toBe(true);
  expect((TICKET_STATUSES as readonly string[]).includes('paused')).toBe(false);
  expect(Object.values(TASK_STATUS_FOR_TICKET_STATUS)).not.toContain('paused');
});

test('the task ladder carries the repeat review between finished and reviewed, and no ticket status reaches it', () => {
  expect(TASK_STATUSES.indexOf('re-review')).toBe(TASK_STATUSES.indexOf('finished') + 1);
  expect(TASK_STATUSES.indexOf('reviewed')).toBe(TASK_STATUSES.indexOf('re-review') + 1);
  expect(taskStatusIsKnown('re-review')).toBe(true);
  expect((TICKET_STATUSES as readonly string[]).includes('re-review')).toBe(false);
  expect(Object.values(TASK_STATUS_FOR_TICKET_STATUS)).not.toContain('re-review');
});

test('both ladders carry the delivered state, between the reviewed end of the ladder and abandoned', () => {
  expect(TASK_STATUSES.indexOf('delivered')).toBe(TASK_STATUSES.indexOf('reviewed') + 1);
  expect(TASK_STATUSES.indexOf('abandoned')).toBe(TASK_STATUSES.indexOf('delivered') + 1);
  expect(TICKET_STATUSES.indexOf('delivered')).toBe(TICKET_STATUSES.indexOf('reviewed') + 1);
  expect(TICKET_STATUSES.indexOf('abandoned')).toBe(TICKET_STATUSES.indexOf('delivered') + 1);
});

test('no name appears twice in a ladder, so an index into it identifies one state', () => {
  expect(new Set(TASK_STATUSES).size).toBe(TASK_STATUSES.length);
  expect(new Set(TICKET_STATUSES).size).toBe(TICKET_STATUSES.length);
});

test('a ticket status crossing into the task ladder keeps its own meaning: in-review becomes finished', () => {
  expect(TASK_STATUS_FOR_TICKET_STATUS['in-review']).toBe('finished');
});

test('pending, reviewed, delivered and abandoned keep their name across the ladders', () => {
  expect(TASK_STATUS_FOR_TICKET_STATUS['pending']).toBe('pending');
  expect(TASK_STATUS_FOR_TICKET_STATUS['reviewed']).toBe('reviewed');
  expect(TASK_STATUS_FOR_TICKET_STATUS['delivered']).toBe('delivered');
  expect(TASK_STATUS_FOR_TICKET_STATUS['abandoned']).toBe('abandoned');
});

test('the mapping has an entry for every ticket status and every entry names a known task status', () => {
  const mappedTicketStatuses = Object.keys(TASK_STATUS_FOR_TICKET_STATUS).sort();
  expect(mappedTicketStatuses).toEqual([...TICKET_STATUSES].sort());
  expect(Object.values(TASK_STATUS_FOR_TICKET_STATUS).filter((status) => !taskStatusIsKnown(status))).toEqual([]);
});
