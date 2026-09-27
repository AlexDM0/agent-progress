/**
 * How much of the log the card shows. The cases that matter: a log of at most the cap of ten entries needs no control and is never cut, and
 * the control and the note say how many entries the cap hides.
 */

import { describe, expect, test } from 'bun:test';
import { LogCapUtil }             from './LogCapUtil.ts';

const {
  logControlIsNeeded,
  logControlText,
  logEntryLimitFor,
  logNoteText,
} = LogCapUtil;

const EXPECTED_CAP_ENTRIES = 10;

describe('the cap', () => {
  test('limits the newest choice to ten entries and the whole-log choice to nothing', () => {
    expect(logEntryLimitFor('newest')).toBe(EXPECTED_CAP_ENTRIES);
    expect(logEntryLimitFor('all')).toBeNull();
  });

  test('needs a control only once the log holds more entries than the cap', () => {
    expect(logControlIsNeeded(EXPECTED_CAP_ENTRIES)).toBe(false);
    expect(logControlIsNeeded(EXPECTED_CAP_ENTRIES + 1)).toBe(true);
  });
});

describe('the control and the note', () => {
  test('names the whole count on the control', () => {
    expect(logControlText(25)).toBe('Show all 25');
  });

  test('says how many entries the cap hides while it is in force', () => {
    expect(logNoteText(25, 'newest')).toBe('newest 10 of 25, 15 hidden');
  });

  // The note of a short log is the one the card always carried, so nothing changes for a board that never reaches the cap.
  test.each([
    ['a log within the cap', 10, 'newest'],
    ['the whole log shown', 25, 'all'],
  ] as const)('keeps the plain note for %s', (_description, entryCount, visibility) => {
    expect(logNoteText(entryCount, visibility)).toBe('newest first');
  });
});
