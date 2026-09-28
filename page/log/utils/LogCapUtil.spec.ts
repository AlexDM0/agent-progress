/**
 * How much of the log the card shows and how it says so. The cases that matter: a long log starts at ten and grows by at most fifty per
 * request, never past what matches; the control appears only while matches are hidden; and the note tells a capped log, a query's
 * match count and a short log apart, with counts grouped in thousands.
 */

import { describe, expect, test } from 'bun:test';
import { LogCapUtil }             from './LogCapUtil.ts';

const {
  firstShownCount,
  logNoteText,
  moreAreHidden,
  moreControlText,
  nextShownCount,
} = LogCapUtil;

const EXPECTED_FIRST_ENTRIES = 10;
const EXPECTED_ADDED_ENTRIES = 50;

describe('the shown count', () => {
  test('starts at ten entries, or every match when fewer match', () => {
    expect(firstShownCount(5_173)).toBe(EXPECTED_FIRST_ENTRIES);
    expect(firstShownCount(4)).toBe(4);
  });

  test('grows by fifty per request and never past the matches', () => {
    expect(nextShownCount(EXPECTED_FIRST_ENTRIES, 5_173)).toBe(EXPECTED_FIRST_ENTRIES + EXPECTED_ADDED_ENTRIES);
    expect(nextShownCount(60, 75)).toBe(75);
  });

  test('pages through a 5,000-entry log without any request adding more than fifty', () => {
    const matchCount = 5_173;
    let shownCount   = firstShownCount(matchCount);
    let requests     = 0;
    while (moreAreHidden(shownCount, matchCount)) {
      const nextCount = nextShownCount(shownCount, matchCount);
      expect(nextCount - shownCount).toBeLessThanOrEqual(EXPECTED_ADDED_ENTRIES);
      expect(nextCount).toBeGreaterThan(shownCount);
      shownCount = nextCount;
      requests  += 1;
    }

    expect(shownCount).toBe(matchCount);
    expect(requests).toBe(Math.ceil((matchCount - EXPECTED_FIRST_ENTRIES) / EXPECTED_ADDED_ENTRIES));
  });
});

describe('the control and the note', () => {
  test('offers fifty more, or only as many as are left', () => {
    expect(moreControlText(10, 5_173)).toBe('Show 50 more');
    expect(moreControlText(60, 75)).toBe('Show 15 more');
  });

  test('needs the control only while matches are hidden', () => {
    expect(moreAreHidden(10, 11)).toBe(true);
    expect(moreAreHidden(10, 10)).toBe(false);
  });

  test('says how much of a long log is shown, grouped in thousands', () => {
    expect(logNoteText(60, 5_173, '')).toBe('newest 60 of 5,173');
  });

  // The note of a short log is the one the card always carried, so nothing changes for a board that never reaches the cap.
  test('keeps the plain note while the whole log is shown', () => {
    expect(logNoteText(6, 6, '')).toBe('newest first');
    expect(logNoteText(6, 6, '   ')).toBe('newest first');
  });

  test('names the match count and the query once a query is typed', () => {
    expect(logNoteText(10, 12, ' #455 ')).toBe('newest 10 of 12 matches for \'#455\'');
    expect(logNoteText(12, 12, '#455')).toBe('12 matches for \'#455\'');
    expect(logNoteText(1, 1, 'review')).toBe('1 match for \'review\'');
    expect(logNoteText(0, 0, 'nothing')).toBe('0 matches for \'nothing\'');
  });
});
