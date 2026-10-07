/** A table search on either page: the query as it is matched, and a matched text with each occurrence marked. */

import { HtmlEscapeUtil } from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';

/** Every run of white space as one space, so a phrase matches across a line break or the tag a body put inside it. */
function collapsedWhiteSpaceOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalisedQueryOf(searchText: string): string {
  return collapsedWhiteSpaceOf(searchText).toLowerCase();
}

/**
 * The text escaped, with each case-insensitive occurrence of the query wrapped in a mark. The text is split before it is escaped, so a
 * query can never match inside an entity; a text whose lower case changes its length is left unmarked rather than marked off by one.
 */
function matchMarkedMarkup(text: string, query: string): string {
  const lowerText = text.toLowerCase();
  if (query === '' || lowerText.length !== text.length) {
    return HtmlEscapeUtil.escapeHtml(text);
  }
  const pieces: string[] = [];
  let position           = 0;
  let matchStart         = lowerText.indexOf(query);
  while (matchStart !== -1) {
    pieces.push(HtmlEscapeUtil.escapeHtml(text.slice(position, matchStart)));
    pieces.push(`<mark class="ap-match">${HtmlEscapeUtil.escapeHtml(text.slice(matchStart, matchStart + query.length))}</mark>`);
    position   = matchStart + query.length;
    matchStart = lowerText.indexOf(query, position);
  }
  pieces.push(HtmlEscapeUtil.escapeHtml(text.slice(position)));
  return pieces.join('');
}

export const SearchMarkUtil = Object.freeze({ collapsedWhiteSpaceOf, normalisedQueryOf, matchMarkedMarkup });
