/**
 * The detail panel's log claim. An entry carrying ids is claimed only by those ids, whatever its sentence names; a note, which carries none,
 * is claimed by its sentence, whose cases that matter are the collisions a plain `#N` search gets wrong: task 1 against task 13, a line
 * opening `Ticket #` that names no row, the row forms the CLI writes, and ticket and row numbers spelled alike from #100 up.
 */
import { describe, expect, test } from 'bun:test';

import { LogClaimUtil } from './LogClaimUtil.ts';

const { entryIsAbout, noteNamesTaskOrTicket } = LogClaimUtil;

describe('an entry carrying ids', () => {
  test('is claimed by its task id or its ticket id', () => {
    const entry = {
      at: '2026-09-18T10:00:00+02:00', text: 'Example line', taskIds: [9], ticketIds: ['012']
    };
    expect([entryIsAbout(entry, 9, null), entryIsAbout(entry, null, '012'), entryIsAbout(entry, 8, '011')]).toEqual([true, true, false]);
  });

  test('is never claimed by the rows and tickets its sentence merely names', () => {
    const entry = {
      at: '2026-09-18T10:00:00+02:00', text: 'Ticket #012 waits on #003 and task #9', taskIds: [], ticketIds: []
    };
    expect([entryIsAbout(entry, 9, '012'), entryIsAbout(entry, null, '003')]).toEqual([false, false]);
  });
});

describe('a note, claimed by its sentence', () => {
  test('a row does not claim a note about a row whose number merely starts with its own', () => {
    expect(noteNamesTaskOrTicket('Task #13 finished', 1, null)).toBe(false);
    expect(noteNamesTaskOrTicket('Task #1 finished', 1, null)).toBe(true);
  });

  test('a note opening as a ticket\'s line names no row, even when its number is the row\'s', () => {
    expect(noteNamesTaskOrTicket('Ticket #120 started', 120, null)).toBe(false);
    expect(noteNamesTaskOrTicket('Ticket #121 filed: Show task #120 in the panel', 120, null)).toBe(false);
  });

  test('a row claims a note in each form the CLI writes for rows', () => {
    expect(noteNamesTaskOrTicket('Task #120 finished', 120, null)).toBe(true);
    expect(noteNamesTaskOrTicket('Review row #120 started: Review 1 #007 — Example', 120, null)).toBe(true);
  });

  test('from #100 up a ticket never claims the notes written for a row of the same number', () => {
    expect(noteNamesTaskOrTicket('Ticket #120 filed: Example', null, '120')).toBe(true);
    expect(noteNamesTaskOrTicket('Task #120 finished', null, '120')).toBe(false);
    expect(noteNamesTaskOrTicket('Review row #120 started: Review 1 #007 — Example', null, '120')).toBe(false);
  });

  test('a ticket claims a note naming it anywhere, but not one naming a ticket whose number starts with its own', () => {
    expect(noteNamesTaskOrTicket('Ticket #003 waits on #001', null, '001')).toBe(true);
    expect(noteNamesTaskOrTicket('Ticket #0012 filed', null, '001')).toBe(false);
  });

  test('a note goes through the sentence rules when the entry carries no ids', () => {
    expect(entryIsAbout({ at: '2026-09-18T10:00:00+02:00', text: 'Ticket #002 started' }, null, '002')).toBe(true);
    expect(entryIsAbout({ at: '2026-09-18T10:00:00+02:00', text: 'Task #1 finished and #002 started' }, null, null)).toBe(false);
  });
});
