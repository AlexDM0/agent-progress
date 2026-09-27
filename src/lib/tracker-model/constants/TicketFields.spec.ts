/**
 * That the ticket type and priority tuples match their unions in `src/lib/tracker-model/@types/Ticket.ts`, that an absent
 * priority has one default, and that the id width keeps a listing in filing order.
 */
import { expect, test } from 'bun:test';

import type { TicketPriority, TicketType } from '../@types/Ticket.ts';
import type { TupleCoversTheUnion }        from '../@types/TupleCoversTheUnion.ts';
import {
  DEFAULT_TICKET_PRIORITY,
  TICKET_ID_DIGITS,
  TICKET_PRIORITIES,
  TICKET_TYPES
}                                          from './TicketFields.ts';

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const TICKET_TYPE_TUPLE_MATCHES_THE_UNION = TICKET_TYPES satisfies readonly TicketType[];

const TICKET_TYPE_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<TicketType, typeof TICKET_TYPES> = true;
const TICKET_PRIORITY_TUPLE_COVERS_THE_UNION: TupleCoversTheUnion<TicketPriority, typeof TICKET_PRIORITIES> = true;

test('every member of the type tuple is a name the union also carries', () => {
  expect(TICKET_TYPE_TUPLE_MATCHES_THE_UNION.length).toBe(3);
});

// A stored type or priority the tuple lacks makes the ticket unreadable, so a union member added without it must not pass.
test('every member of the type and priority unions is a name the matching tuple also carries', () => {
  expect([TICKET_TYPE_TUPLE_COVERS_THE_UNION, TICKET_PRIORITY_TUPLE_COVERS_THE_UNION]).toEqual([true, true]);
});

test('no ticket type appears twice, so an index into the tuple identifies one type', () => {
  expect(new Set(TICKET_TYPES).size).toBe(TICKET_TYPES.length);
});

// A ticket file written before priorities existed carries no key, and must read as the middle priority rather than as the lowest.
test('the priorities are exactly low, normal and high, and the default is normal', () => {
  const priorityTupleMatchesTheUnion = TICKET_PRIORITIES satisfies readonly TicketPriority[];
  expect(priorityTupleMatchesTheUnion).toEqual(['low', 'normal', 'high']);
  expect(DEFAULT_TICKET_PRIORITY).toBe('normal');
});

test('a ticket id is padded to at least two digits, so a listing of the first ten tickets still sorts in filing order', () => {
  expect(TICKET_ID_DIGITS).toBeGreaterThanOrEqual(2);
});
