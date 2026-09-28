/** How much of the log the page's log card shows: the newest few first, more on each request, and the note and control that say so. */

const LOG_ENTRIES_SHOWN_FIRST        = 10;
const LOG_ENTRIES_ADDED_PER_REQUEST  = 50;
const COUNT_FORMAT                   = new Intl.NumberFormat('en-US');

function countText(count: number): string {
  return COUNT_FORMAT.format(count);
}

function firstShownCount(matchCount: number): number {
  return Math.min(LOG_ENTRIES_SHOWN_FIRST, matchCount);
}

function nextShownCount(shownCount: number, matchCount: number): number {
  return Math.min(shownCount + LOG_ENTRIES_ADDED_PER_REQUEST, matchCount);
}

function moreAreHidden(shownCount: number, matchCount: number): boolean {
  return shownCount < matchCount;
}

function moreControlText(shownCount: number, matchCount: number): string {
  return `Show ${countText(nextShownCount(shownCount, matchCount) - shownCount)} more`;
}

/** Without a query the whole log shown keeps the card's plain note; a query always says how many entries it matched. */
function logNoteText(shownCount: number, matchCount: number, query: string): string {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return moreAreHidden(shownCount, matchCount) ? `newest ${countText(shownCount)} of ${countText(matchCount)}` : 'newest first';
  }
  const matches = `${countText(matchCount)} ${matchCount === 1 ? 'match' : 'matches'} for '${trimmedQuery}'`;
  return moreAreHidden(shownCount, matchCount) ? `newest ${countText(shownCount)} of ${matches}` : matches;
}

export const LogCapUtil = {
  firstShownCount,
  nextShownCount,
  moreAreHidden,
  moreControlText,
  logNoteText,
} as const;
