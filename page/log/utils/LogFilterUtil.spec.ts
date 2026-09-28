/**
 * The log card's filter. The cases that matter: `#455` keeps a record by its ids and a note by its sentence, and never an entry about
 * #4555, a row numbered 455 or a record whose sentence merely mentions #455; any other query is a case-insensitive substring; an empty
 * query keeps everything.
 */

import { describe, expect, test }  from 'bun:test';
import type { IdentifiedLogEntry } from '../../../src/shared/@types/WordedLogEntry.ts';
import { LogFilterUtil }           from './LogFilterUtil.ts';

const { entriesMatchingQuery, entryMatchesQuery } = LogFilterUtil;

const STAMP = '2026-09-18T21:56:00+02:00';

function record(text: string, ticketIds: string[], taskIds: number[] = []): IdentifiedLogEntry {
  return {
    at: STAMP,
    text,
    ticketIds,
    taskIds,
  };
}

function note(text: string): IdentifiedLogEntry {
  return { at: STAMP, text };
}

describe('a ticket query', () => {
  test('keeps a record whose ids hold the ticket', () => {
    expect(entryMatchesQuery(record('Ticket #455 started', ['455']), '#455')).toBe(true);
  });

  // The ids are the record's claim, so a sentence that quotes another ticket's number does not make it that ticket's.
  test('drops a record whose ids do not hold the ticket, whatever its sentence says', () => {
    expect(entryMatchesQuery(record('Ticket #300 filed: follow-up to #455', ['300']), '#455')).toBe(false);
  });

  test('keeps a note naming the ticket as a whole token', () => {
    expect(entryMatchesQuery(note('Merged the fix for #455 by hand'), '#455')).toBe(true);
  });

  test.each([
    ['a record about #4555', record('Ticket #4555 started', ['4555'])],
    ['a note about #4555', note('Looked at #4555 again')],
    ['a note naming row 455', note('Task #455 finished')],
  ])('never keeps %s', (_description, entry) => {
    expect(entryMatchesQuery(entry, '#455')).toBe(false);
  });

  test('keeps the entries for the ticket in the order it was given them', () => {
    const entries = [
      record('Ticket #455 filed', ['455']),
      record('Ticket #4555 filed', ['4555']),
      note('Paused #455 for the release'),
      record('Task #9 started', [], [9]),
    ];

    expect(entriesMatchingQuery(entries, '#455').map((entry) => entry.text)).toEqual(['Ticket #455 filed', 'Paused #455 for the release']);
  });
});

describe('a text query', () => {
  test('keeps an entry whose sentence holds the text in any case', () => {
    expect(entryMatchesQuery(note('Review PASSED on the branch'), 'passed')).toBe(true);
    expect(entryMatchesQuery(note('Review failed'), 'passed')).toBe(false);
  });

  // Surrounding blanks are no text of their own, so a stray space keeps `#455` a ticket query; other text beside it makes it a substring.
  test('reads a trimmed #N as a ticket and anything more as text', () => {
    expect(entryMatchesQuery(record('Ticket #4555 started', ['4555']), ' #455 ')).toBe(false);
    expect(entryMatchesQuery(record('Ticket #4555 started', ['4555']), 'Ticket #455')).toBe(true);
  });

  test('keeps every entry for an empty or blank query', () => {
    const entries = [note('One'), note('Two')];

    expect(entriesMatchingQuery(entries, '')).toEqual(entries);
    expect(entriesMatchingQuery(entries, '  ')).toEqual(entries);
  });
});
