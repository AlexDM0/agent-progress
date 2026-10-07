/**
 * The table search both pages share. The cases that matter are the marks, which must never split an escaped character, and the query
 * read the way a reader typed it: case and runs of white space never decide a match.
 */

import { describe, expect, test } from 'bun:test';

import { SearchMarkUtil } from './SearchMarkUtil.ts';

const { matchMarkedMarkup } = SearchMarkUtil;

describe('matchMarkedMarkup', () => {
  test('marks every occurrence, whatever its case', () => {
    expect(matchMarkedMarkup('Dark mode, darker', 'dark')).toBe('<mark class="ap-match">Dark</mark> mode, <mark class="ap-match">dark</mark>er');
  });

  // Marking after escaping would let "amp" match inside "&amp;" and break the entity.
  test('never matches inside an escaped character', () => {
    expect(matchMarkedMarkup('Q&A', 'amp')).toBe('Q&amp;A');
    expect(matchMarkedMarkup('a <b> c', '<b>')).toBe('a <mark class="ap-match">&lt;b&gt;</mark> c');
  });

  test('escapes the text when there is nothing to mark', () => {
    expect(matchMarkedMarkup('<i>', '')).toBe('&lt;i&gt;');
  });
});

describe('the query', () => {
  test('is lower case with every run of white space one space, trimmed', () => {
    expect(SearchMarkUtil.normalisedQueryOf('  Wish\n  LIST ')).toBe('wish list');
  });

  test('collapsing keeps the case', () => {
    expect(SearchMarkUtil.collapsedWhiteSpaceOf('A\t\tB ')).toBe('A B');
  });
});
