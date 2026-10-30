/**
 * A table search: the query as it is matched, and a text cut into the pieces a view draws, each occurrence of the query a marked piece.
 * The pieces are plain text, so the view's own escaping is the one escape; a text whose lower case changes its length is left unmarked
 * rather than marked off by one.
 */
export interface MatchPiece {
  readonly text:    string;
  readonly isMatch: boolean;
}

/** Every run of white space as one space, so a phrase matches across a line break or the tag a body put inside it. */
function collapsedWhiteSpaceOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalisedQueryOf(searchText: string): string {
  return collapsedWhiteSpaceOf(searchText).toLowerCase();
}

function matchPiecesOf(text: string, query: string): MatchPiece[] {
  const lowerText = text.toLowerCase();
  if (query === '' || lowerText.length !== text.length) return text === '' ? [] : [{ text, isMatch: false }];
  const pieces: MatchPiece[] = [];
  let position = 0;
  let matchStart = lowerText.indexOf(query);
  while (matchStart !== -1) {
    if (matchStart > position) pieces.push({ text: text.slice(position, matchStart), isMatch: false });
    pieces.push({ text: text.slice(matchStart, matchStart + query.length), isMatch: true });
    position = matchStart + query.length;
    matchStart = lowerText.indexOf(query, position);
  }
  if (position < text.length) pieces.push({ text: text.slice(position), isMatch: false });
  return pieces;
}

export const SearchMatchUtil = Object.freeze({ collapsedWhiteSpaceOf, normalisedQueryOf, matchPiecesOf });
