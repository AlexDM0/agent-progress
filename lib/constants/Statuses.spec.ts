/**
 * That the runtime tuples and the unions in `lib/constants/Types.ts` still describe the same
 * vocabulary, and that the guards accept exactly the tuple and nothing that merely looks like it.
 */
import { expect, test } from 'bun:test';

import {
  CLAUDE_MANAGED_END,
  CLAUDE_MANAGED_START,
  HTML_FILE_NAME,
  LOCK_FILE_NAME,
  PROGRESS_FILE_NAME,
  TASK_STATUSES,
  TASK_STATUS_FOR_TICKET_STATUS,
  TICKETS_DIRECTORY_NAME,
  TICKET_STATUSES,
  TICKET_TYPES,
  TRACKER_DIRECTORY_NAME,
  taskStatusIsKnown,
  ticketStatusIsKnown,
  ticketTypeIsKnown
} from './Statuses';
import type { TaskStatus, TicketStatus, TicketType } from './Types';

/** A tuple member the union has never heard of fails `bun run typecheck` rather than a test. */
const TASK_STATUS_TUPLE_MATCHES_THE_UNION = TASK_STATUSES satisfies readonly TaskStatus[];
const TICKET_STATUS_TUPLE_MATCHES_THE_UNION = TICKET_STATUSES satisfies readonly TicketStatus[];
const TICKET_TYPE_TUPLE_MATCHES_THE_UNION = TICKET_TYPES satisfies readonly TicketType[];

test('every member of each tuple is a name the matching union also carries', () => {
  expect(TASK_STATUS_TUPLE_MATCHES_THE_UNION.length).toBeGreaterThanOrEqual(7);
  expect(TICKET_STATUS_TUPLE_MATCHES_THE_UNION.length).toBeGreaterThanOrEqual(6);
  expect(TICKET_TYPE_TUPLE_MATCHES_THE_UNION.length).toBe(3);
});

test('the task ladder carries paused between running and finished, and no ticket status reaches it', () => {
  expect(TASK_STATUSES.indexOf('paused')).toBe(TASK_STATUSES.indexOf('running') + 1);
  expect(TASK_STATUSES.indexOf('finished')).toBe(TASK_STATUSES.indexOf('paused') + 1);
  expect(taskStatusIsKnown('paused')).toBe(true);
  expect((TICKET_STATUSES as readonly string[]).includes('paused')).toBe(false);
  expect(Object.values(TASK_STATUS_FOR_TICKET_STATUS)).not.toContain('paused');
});

test('both ladders carry the delivered state, between the reviewed end of the ladder and abandoned', () => {
  expect(TASK_STATUSES.indexOf('delivered')).toBe(TASK_STATUSES.indexOf('reviewed') + 1);
  expect(TASK_STATUSES.indexOf('abandoned')).toBe(TASK_STATUSES.indexOf('delivered') + 1);
  expect(TICKET_STATUSES.indexOf('delivered')).toBe(TICKET_STATUSES.indexOf('done') + 1);
  expect(TICKET_STATUSES.indexOf('abandoned')).toBe(TICKET_STATUSES.indexOf('delivered') + 1);
});

test('no name appears twice in a ladder, so an index into it identifies one state', () => {
  expect(new Set(TASK_STATUSES).size).toBe(TASK_STATUSES.length);
  expect(new Set(TICKET_STATUSES).size).toBe(TICKET_STATUSES.length);
  expect(new Set(TICKET_TYPES).size).toBe(TICKET_TYPES.length);
});

test('each guard accepts every member of its own tuple', () => {
  expect(TASK_STATUSES.filter((status) => !taskStatusIsKnown(status))).toEqual([]);
  expect(TICKET_STATUSES.filter((status) => !ticketStatusIsKnown(status))).toEqual([]);
  expect(TICKET_TYPES.filter((type) => !ticketTypeIsKnown(type))).toEqual([]);
});

test('a guard refuses a plausible near-miss rather than rounding it to the nearest member', () => {
  for (const nearMiss of ['', 'Pending', 'in progress', 'complete', 'todo', 'delivered ', 'pendin']) {
    expect(taskStatusIsKnown(nearMiss), `task status "${nearMiss}"`).toBe(false);
    expect(ticketStatusIsKnown(nearMiss), `ticket status "${nearMiss}"`).toBe(false);
    expect(ticketTypeIsKnown(nearMiss), `ticket type "${nearMiss}"`).toBe(false);
  }
});

test('a guard refuses a name inherited from Object.prototype', () => {
  for (const inheritedName of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    expect(taskStatusIsKnown(inheritedName), inheritedName).toBe(false);
    expect(ticketStatusIsKnown(inheritedName), inheritedName).toBe(false);
    expect(ticketTypeIsKnown(inheritedName), inheritedName).toBe(false);
  }
});

test('a ticket status crossing into the task ladder keeps its own meaning: in-review becomes finished and done becomes reviewed', () => {
  expect(TASK_STATUS_FOR_TICKET_STATUS['in-review']).toBe('finished');
  expect(TASK_STATUS_FOR_TICKET_STATUS['done']).toBe('reviewed');
});

test('delivered and abandoned are the two states that keep their name across the ladders', () => {
  expect(TASK_STATUS_FOR_TICKET_STATUS['delivered']).toBe('delivered');
  expect(TASK_STATUS_FOR_TICKET_STATUS['abandoned']).toBe('abandoned');
});

test('the mapping has an entry for every ticket status and every entry names a known task status', () => {
  const mappedTicketStatuses = Object.keys(TASK_STATUS_FOR_TICKET_STATUS).sort();
  expect(mappedTicketStatuses).toEqual([...TICKET_STATUSES].sort());
  expect(Object.values(TASK_STATUS_FOR_TICKET_STATUS).filter((status) => !taskStatusIsKnown(status))).toEqual([]);
});

test('every path constant is a bare name, so joining one onto a directory cannot escape it', () => {
  for (const name of [PROGRESS_FILE_NAME, HTML_FILE_NAME, TRACKER_DIRECTORY_NAME, TICKETS_DIRECTORY_NAME, LOCK_FILE_NAME]) {
    expect(name.length, 'a path constant is never empty').toBeGreaterThan(0);
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name.includes('..'), `"${name}" has no parent-directory segment`).toBe(false);
  }
});

test('neither managed marker contains the other, so the search for the end marker cannot match the start marker', () => {
  expect(CLAUDE_MANAGED_START).not.toBe(CLAUDE_MANAGED_END);
  expect(CLAUDE_MANAGED_START).not.toContain(CLAUDE_MANAGED_END);
  expect(CLAUDE_MANAGED_END).not.toContain(CLAUDE_MANAGED_START);
});

test('both markers are HTML comments on a single line, so they stay invisible in a rendered CLAUDE.md', () => {
  for (const marker of [CLAUDE_MANAGED_START, CLAUDE_MANAGED_END]) {
    expect(marker.startsWith('<!--'), marker).toBe(true);
    expect(marker.endsWith('-->'), marker).toBe(true);
    expect(marker).not.toContain('\n');
  }
});
