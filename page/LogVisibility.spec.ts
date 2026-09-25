/**
 * How much of the log the card shows. The cases that matter: a log of at most the cap needs no control and is never cut, and the control
 * and the note say how many entries the cap hides.
 */

import { describe, expect, test } from 'bun:test';
import {
  LOG_ENTRIES_SHOWN_BY_DEFAULT,
  logControlIsNeeded,
  logControlText,
  logEntryLimitFor,
  logNoteText,
} from './LogVisibility.ts';

describe('the cap', () => {
  test('is ten entries', () => {
    expect(LOG_ENTRIES_SHOWN_BY_DEFAULT).toBe(10);
  });

  test('needs a control only once the log holds more entries than the cap', () => {
    expect(logControlIsNeeded(LOG_ENTRIES_SHOWN_BY_DEFAULT)).toBe(false);
    expect(logControlIsNeeded(LOG_ENTRIES_SHOWN_BY_DEFAULT + 1)).toBe(true);
  });

  test('limits the newest choice to the cap and the whole-log choice to nothing', () => {
    expect(logEntryLimitFor('newest')).toBe(LOG_ENTRIES_SHOWN_BY_DEFAULT);
    expect(logEntryLimitFor('all')).toBeNull();
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
