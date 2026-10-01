/**
 * An epic file read and written back. The cases that matter: the description survives byte for byte, a `---` line in it included; a
 * hand-written line the CLI does not own survives a rewrite; a CRLF file stays CRLF; and every file the CLI cannot understand is a
 * verdict naming the line, never a throw.
 */
import { expect, test } from 'bun:test';

import { EpicDocumentUtil } from './EpicDocumentUtil.ts';

const { epicDocumentTextOf, parsedEpicDocumentOf } = EpicDocumentUtil;

const WRITTEN_EPIC = '---\nkey: "checkout-redesign"\ntitle: "Checkout redesign"\nslot: 2\n---\nThe checkout, rebuilt.\n\n---\n\nAfter a rule.\n';

test('a written epic reads back and writes back byte for byte, its description holding a rule', () => {
  const parsed = parsedEpicDocumentOf(WRITTEN_EPIC);
  if (parsed.verdict !== 'parsed') throw new Error(parsed.reason);

  expect(parsed.frontmatter).toEqual({
    key: 'checkout-redesign', title: 'Checkout redesign', slot: 2, extra: []
  });
  expect(parsed.body).toBe('The checkout, rebuilt.\n\n---\n\nAfter a rule.\n');
  expect(epicDocumentTextOf(parsed.frontmatter, parsed.body, parsed.lineEnding)).toBe(WRITTEN_EPIC);
});

test('unquoted values read as text, and an unknown key, a comment and a blank line survive a rewrite in CRLF', () => {
  const handWritten = ['---', 'key: search', 'owner: Alex Example', '# kept by hand', '', 'title: Search', 'slot: 1', '---', 'Body.', ''].join('\r\n');
  const parsed      = parsedEpicDocumentOf(handWritten);
  if (parsed.verdict !== 'parsed') throw new Error(parsed.reason);

  expect(parsed.frontmatter.extra).toEqual([['owner', 'Alex Example'], ['#', 'kept by hand'], ['', '']]);
  expect(epicDocumentTextOf(parsed.frontmatter, parsed.body, parsed.lineEnding))
    .toBe(['---', 'key: "search"', 'title: "Search"', 'slot: 1', 'owner: Alex Example', '# kept by hand', '', '---', 'Body.', ''].join('\r\n'));
});

test('a file the CLI cannot understand is a verdict with its reason and line', () => {
  expect(parsedEpicDocumentOf('key: "search"\n')).toEqual({ verdict: 'malformed', reason: 'the first line must be the frontmatter fence `---`', line: 1 });
  expect(parsedEpicDocumentOf('---\nkey: "search"\n')).toMatchObject({ verdict: 'malformed', reason: 'the frontmatter has no closing `---` fence' });
  expect(parsedEpicDocumentOf('---\nkey: "search"\nslot: 1\n---\n')).toEqual({ verdict: 'malformed', reason: 'the frontmatter has no `title` key', line: 4 });
  expect(parsedEpicDocumentOf('---\nkey: "Search"\ntitle: x\nslot: 1\n---\n')).toEqual({ verdict: 'malformed', reason: '`key` is not an epic key: Search', line: 2 });
  expect(parsedEpicDocumentOf('---\nkey: search\ntitle: x\nslot: 7\n---\n')).toEqual({ verdict: 'malformed', reason: '`slot` is not a colour slot from 1 to 6: 7', line: 4 });
  expect(parsedEpicDocumentOf('---\nkey: search\nnot a line\n---\n')).toEqual({ verdict: 'malformed', reason: '`not a line` is not a `key: value` line', line: 3 });
  expect(parsedEpicDocumentOf('---\nkey: "search\ntitle: x\nslot: 1\n---\n')).toMatchObject({ verdict: 'malformed', line: 2 });
});
