/**
 * Whether a ticket title can attack `progress.html`: `&` is escaped first so an escape is never
 * escaped again, and every `<` is escaped so no island can close its script tag or open a comment.
 */
import { expect, test } from 'bun:test';

import { HtmlEscapeUtil } from './HtmlEscapeUtil';

const { escapeHtml, escapeJsonForScriptTag } = HtmlEscapeUtil;

test('escapes the five characters that can end an element or an attribute', () => {
  expect(escapeHtml('<b title="x">Alex & \'co\'</b>')).toBe('&lt;b title=&quot;x&quot;&gt;Alex &amp; &#39;co&#39;&lt;/b&gt;');
});

test('escapes the ampersand first, so an escape is never itself escaped', () => {
  expect(escapeHtml('<')).toBe('&lt;');
  expect(escapeHtml('&lt;')).toBe('&amp;lt;');
});

test('leaves text with nothing to escape byte for byte alone', () => {
  const plain = 'Double-click a role to edit it — Alex Example, Example Agency';
  expect(escapeHtml(plain)).toBe(plain);
});

test('escapes every occurrence, not only the first', () => {
  expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;');
});

test('a task name holding a closing script tag cannot end the JSON island', () => {
  // An HTML parser ends a `<script>` at the first `</script`, inside a JSON string or not.
  const island = JSON.stringify({ name: '</script><script>alert(1)</script>' });
  const escaped = escapeJsonForScriptTag(island);
  expect(escaped).not.toContain('</script');
  expect(escaped).not.toContain('</');
});

test('a closing tag in any casing or with a newline after it is neutralised too', () => {
  for (const spelling of ['</script>', '</SCRIPT>', '</script\n>']) {
    expect(escapeJsonForScriptTag(JSON.stringify({ text: spelling }))).not.toContain('</');
  }
});

test('a comment opener cannot put the tokenizer into its double-escaped state', () => {
  const island = JSON.stringify({ name: 'x <!--<script>' });
  const escaped = escapeJsonForScriptTag(island);
  expect(escaped).not.toContain('<!--');
  expect(escaped).not.toContain('<script');
});

test('no less-than sign survives at all, whatever it was part of', () => {
  const island = JSON.stringify({ text: '2 < 3 <!-- <SCRIPT </Script <!DOCTYPE' });
  expect(escapeJsonForScriptTag(island)).not.toContain('<');
});

test('the escaped island still parses back to the identical value', () => {
  const original = { note: 'see </script> and <!-- and 2 < 3', title: 'Alex Example' };
  expect(JSON.parse(escapeJsonForScriptTag(JSON.stringify(original)))).toEqual(original);
});

test('the two line terminators JSON allows and JavaScript does not are escaped', () => {
  const withSeparators = JSON.stringify({ text: 'one\u2028two\u2029three' });
  const escaped = escapeJsonForScriptTag(withSeparators);
  expect(escaped).not.toContain('\u2028');
  expect(escaped).not.toContain('\u2029');
  expect(JSON.parse(escaped)).toEqual({ text: 'one\u2028two\u2029three' });
});

test('an island with nothing dangerous in it is passed through unchanged', () => {
  const harmless = JSON.stringify({ project: 'Example Agency', version: 1 });
  expect(escapeJsonForScriptTag(harmless)).toBe(harmless);
});
