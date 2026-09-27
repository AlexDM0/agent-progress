/**
 * That the status tuples and the unions in `src/lib/tracker-model/@types/` still describe the same ladders, that each
 * ladder holds its states in order and once, and that every ticket status is a task status, paused and re-review being the task's own.
 */
import { expect, test } from 'bun:test';

import type { TupleCoversTheUnion }       from '../../../testing/TupleCoversTheUnion.ts';
import type { TaskStatus }                from '../@types/Task.ts';
import type { TicketStatus }              from '../@types/Ticket.ts';
import { VocabularyUtil }                 from '../utils/VocabularyUtil.ts';
import { TASK_STATUSES, TICKET_STATUSES } from './Statuses.ts';

const { taskStatusIsKnown } = VocabularyUtil;

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const TASK_STATUS_TUPLE_MATCHES_THE_UNION = TASK_STATUSES satisfies readonly TaskStatus[];
const TICKET_STATUS_TUPLE_MATCHES_THE_UNION = TICKET_STATUSES satisfies readonly TicketStatus[];
const TICKET_STATUS_TUPLE_FITS_THE_TASK_LADDER = TICKET_STATUSES satisfies readonly TaskStatus[];

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

test('the task ladder carries paused between in-progress and in-review, and no ticket status reaches it', () => {
  expect(TASK_STATUSES.indexOf('paused')).toBe(TASK_STATUSES.indexOf('in-progress') + 1);
  expect(TASK_STATUSES.indexOf('in-review')).toBe(TASK_STATUSES.indexOf('paused') + 1);
  expect(taskStatusIsKnown('paused')).toBe(true);
  expect((TICKET_STATUSES as readonly string[]).includes('paused')).toBe(false);
});

test('the task ladder carries the repeat review between in-review and reviewed, and no ticket status reaches it', () => {
  expect(TASK_STATUSES.indexOf('re-review')).toBe(TASK_STATUSES.indexOf('in-review') + 1);
  expect(TASK_STATUSES.indexOf('reviewed')).toBe(TASK_STATUSES.indexOf('re-review') + 1);
  expect(taskStatusIsKnown('re-review')).toBe(true);
  expect((TICKET_STATUSES as readonly string[]).includes('re-review')).toBe(false);
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

// A ticket moves its row to the same word, so a ticket status the task ladder lacks would leave that row nowhere to go.
test('every ticket status is also a task status', () => {
  expect(TICKET_STATUS_TUPLE_FITS_THE_TASK_LADDER.length).toBe(TICKET_STATUSES.length);
  expect(TICKET_STATUSES.filter((status) => !taskStatusIsKnown(status))).toEqual([]);
});

test('paused and re-review are the only task statuses a ticket never takes', () => {
  const ticketStatuses: readonly string[] = TICKET_STATUSES;
  expect(TASK_STATUSES.filter((status) => !ticketStatuses.includes(status))).toEqual(['paused', 're-review']);
});
