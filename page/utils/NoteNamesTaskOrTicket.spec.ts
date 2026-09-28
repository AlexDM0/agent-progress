/**
 * The sentence rules an id-less note is claimed by. The cases that matter are the collisions a plain `#N` search gets wrong: task 1
 * against task 13, a line opening `Ticket #` that names no row, the row forms the CLI writes, and ticket and row numbers spelled alike
 * from #100 up.
 */

import { expect, test } from 'bun:test';

import { noteNamesTaskOrTicket, ticketReferencesIn } from './NoteNamesTaskOrTicket.ts';

test('a row does not claim a note about a row whose number merely starts with its own', () => {
  expect(noteNamesTaskOrTicket('Task #13 finished', 1, null)).toBe(false);
  expect(noteNamesTaskOrTicket('Task #1 finished', 1, null)).toBe(true);
});

test('a note opening as a ticket’s line names no row, even when its number is the row’s', () => {
  expect(noteNamesTaskOrTicket('Ticket #120 started', 120, null)).toBe(false);
  expect(noteNamesTaskOrTicket('Ticket #121 filed: Show task #120 in the panel', 120, null)).toBe(false);
});

test('a row claims a note in each form the CLI writes for rows', () => {
  expect(noteNamesTaskOrTicket('Task #120 finished', 120, null)).toBe(true);
  expect(noteNamesTaskOrTicket('Review row #120 started: Review 1 #007 — Example', 120, null)).toBe(true);
  expect(noteNamesTaskOrTicket('Closed the review row #120, delivered: Review 1 #007 — Example', 120, null)).toBe(true);
});

test('from #100 up a ticket never claims the notes written for a row of the same number', () => {
  expect(noteNamesTaskOrTicket('Ticket #120 filed: Example', null, '120')).toBe(true);
  expect(noteNamesTaskOrTicket('Review row #9 started: Review 1 #120 — Example', null, '120')).toBe(true);
  expect(noteNamesTaskOrTicket('Task #120 finished', null, '120')).toBe(false);
  expect(noteNamesTaskOrTicket('Review row #120 started: Review 1 #007 — Example', null, '120')).toBe(false);
});

test('a ticket claims a note naming it anywhere, but not one naming a ticket whose number starts with its own', () => {
  expect(noteNamesTaskOrTicket('Ticket #003 waits on #001', null, '001')).toBe(true);
  expect(noteNamesTaskOrTicket('Ticket #0012 filed', null, '001')).toBe(false);
});

test('a note is claimed when it names either the row or the ticket, and by neither when both are absent', () => {
  expect(noteNamesTaskOrTicket('Task #1 finished', 1, '002')).toBe(true);
  expect(noteNamesTaskOrTicket('Ticket #002 started', 1, '002')).toBe(true);
  expect(noteNamesTaskOrTicket('Task #1 finished and #002 started', null, null)).toBe(false);
});

// The log links exactly what the claim reads as a ticket, so the references follow the same rule, with the positions the link replaces.
test('finds every whole ticket reference with its position, and no row form', () => {
  const text = 'Task #120 finished; #007 and #0012 next';

  expect(ticketReferencesIn(text)).toEqual([
    { ticketId: '007', start: 20, end: 24 },
    { ticketId: '0012', start: 29, end: 34 },
  ]);
  expect(ticketReferencesIn('Review row #9 started')).toEqual([]);
});
