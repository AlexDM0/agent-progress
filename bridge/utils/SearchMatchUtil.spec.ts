/**
 * The table search as the Bridge draws it. The cases that matter are the pieces, which join back to the text exactly and mark every
 * occurrence whatever its case, a markup-looking text staying plain text, and the query read the way a reader typed it.
 */
import { describe, expect, test } from 'bun:test';

import { SearchMatchUtil } from './SearchMatchUtil.ts';

const { matchPiecesOf, normalisedQueryOf } = SearchMatchUtil;

describe('matchPiecesOf', () => {
  test('marks every occurrence, whatever its case, and the pieces join back to the text', () => {
    const pieces = matchPiecesOf('Dark mode, darker', 'dark');
    expect(pieces).toEqual([
      { text: 'Dark', isMatch: true },
      { text: ' mode, ', isMatch: false },
      { text: 'dark', isMatch: true },
      { text: 'er', isMatch: false },
    ]);
    expect(pieces.map((piece) => piece.text).join('')).toBe('Dark mode, darker');
  });

  test('a markup-looking text stays one plain piece, its brackets unescaped, for the view to escape once', () => {
    expect(matchPiecesOf('<b>&amp;</b>', '')).toEqual([{ text: '<b>&amp;</b>', isMatch: false }]);
    expect(matchPiecesOf('a <b> c', 'b')).toEqual([{ text: 'a <', isMatch: false }, { text: 'b', isMatch: true }, { text: '> c', isMatch: false }]);
  });

  test('a text whose lower case changes its length is left unmarked', () => {
    expect(matchPiecesOf('İstanbul', 'stan')).toEqual([{ text: 'İstanbul', isMatch: false }]);
  });

  test('an empty text has no piece', () => {
    expect(matchPiecesOf('', 'dark')).toEqual([]);
  });
});

describe('normalisedQueryOf', () => {
  test('case and runs of white space never decide a match', () => {
    expect(normalisedQueryOf('  Dark\n  MODE ')).toBe('dark mode');
  });
});
