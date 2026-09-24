/**
 * Where `lib/render/Markdown.ts` deliberately departs from marked: raw HTML escaped rather than
 * passed through, and only allowlisted link schemes surviving.
 */

import { describe, expect, test } from 'bun:test';
import { renderMarkdown }         from './Markdown.ts';

describe('renderMarkdown', () => {
  test('renders a fenced block as preformatted code carrying its language', () => {
    const html = renderMarkdown('```ts\nconst example = 1;\n```');

    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('const example = 1;');
  });

  test('renders a GitHub-flavoured table as a real table', () => {
    const html = renderMarkdown('| owner | status |\n| --- | --- |\n| Alex Example | running |');

    expect(html).toContain('<table>');
    expect(html).toContain('<th>owner</th>');
    expect(html).toContain('<td>Alex Example</td>');
  });

  test('nests a nested list rather than flattening it', () => {
    const html = renderMarkdown('- one\n  - two\n    - three');

    expect(html).toContain('<li>one<ul>');
    expect(html).toContain('<li>three</li>');
  });

  test('escapes a script element in a ticket body instead of emitting one', () => {
    const html = renderMarkdown('Before\n\n<script>alert(1)</script>\n\nafter');

    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes inline HTML in a paragraph as well as a block of it', () => {
    const html = renderMarkdown('a sentence about <b>bold</b> markup');

    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  test('drops a javascript: link and leaves its formatted text standing', () => {
    const html = renderMarkdown('[click **me**](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click <strong>me</strong>');
  });

  test.each([
    ['a named entity for the colon', '[x](javascript&colon;alert(1))'],
    ['a decimal entity for the first letter', '[x](&#106;avascript:alert(1))'],
    ['a hex entity for the first letter', '[x](&#x6a;avascript:alert(1))'],
    ['a doubly encoded entity', '[x](&amp;#106;avascript:alert(1))'],
    ['mixed case', '[x](JaVaScRiPt:alert(1))'],
    ['a control character inside the scheme', '[x](java\tscript:alert(1))'],
    ['the vbscript scheme', '[x](vbscript:msgbox(1))'],
    ['the file scheme', '[x](file:///etc/passwd)'],
    ['the data scheme', '[x](data:text/html;base64,PHNjcmlwdD4=)'],
    ['a decimal entity for the colon with no semicolon', '[x](javascript&#58alert(document.title))'],
    ['a zero-padded decimal entity with no semicolon', '[x](&#0000106avascript:alert(7))'],
    ['hex entities with no semicolon', '[x](&#x6A&#x61vascript:alert(1))'],
    ['an upper-case hex entity with no semicolon', '[x](jav&#X61script:alert(1))'],
    ['a hex entity for the colon with no semicolon', '[x](javascript&#x3A/alert(1))'],
    ['a named tab inside the scheme', '[x](java&Tab;script:alert(1))'],
    ['a named newline inside the scheme', '[x](java&NewLine;script:alert(1))'],
    ['a decimal tab with no semicolon inside the scheme', '[x](java&#9script:alert(1))'],
    ['leading whitespace and control characters', '[x](&#1;&#32;javascript:alert(1))'],
    ['an upper-case scheme', '[x](JAVASCRIPT:alert(1))'],
    ['an upper-case vbscript scheme', '[x](VBSCRIPT:msgbox(1))'],
    ['an upper-case data scheme', '[x](DATA:text/html,x)'],
    ['a named reference no decoder here knows', '[x](javascript&lpar;:alert(1))'],
    ['a reference still encoded after every decoding pass', '[x](&amp;amp;amp;amp;#106;avascript:alert(1))'],
  ])('renders no anchor for a link hiding its scheme behind %s', (_description, source) => {
    const html = renderMarkdown(source);

    expect(html).not.toContain('<a ');
    expect(html).toContain('x');
  });

  // A reference past the last code point used to throw out of the render, taking the whole page with it.
  test('drops a link whose reference names no code point instead of throwing', () => {
    const html = renderMarkdown('[x](&#99999999;avascript:alert(1)) and [y](&#x110000javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('x');
    expect(html).toContain('y');
  });

  test.each([
    ['[an image with a decimal entity]', '![alt text](&#106;avascript:alert(1))'],
    ['[an image with vbscript]', '![alt text](vbscript:msgbox(1))'],
    ['[an image with data]', '![alt text](data:text/html,x)'],
  ])('renders no image element for %s, keeping its alt text', (_description, source) => {
    const html = renderMarkdown(source);

    expect(html).not.toContain('<img');
    expect(html).toContain('alt text');
  });

  test('drops a data: image and leaves its alt text standing', () => {
    const html = renderMarkdown('![alt text](data:text/html;base64,PHNjcmlwdD4=)');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('data:');
    expect(html).toContain('alt text');
  });

  test.each([
    ['an in-page anchor, which is how a ticket points at its Gantt row', '[the row](#task-17)', '<a href="#task-17">the row</a>'],
    ['a relative path', '[the backlog](./docs/backlog.md)', '<a href="./docs/backlog.md">the backlog</a>'],
    ['an https link', '[home](https://example.com/x)', '<a href="https://example.com/x">home</a>'],
    ['a mailto link', '[mail](mailto:alex.example@example.com)', '<a href="mailto:alex.example@example.com">mail</a>'],
    ['an https link whose query carries an ampersand', '[search](https://example.com/?a=1&b=2)', '<a href="https://example.com/?a=1&b=2">search</a>'],
    ['an allowed scheme spelled with a reference', '[home](https&#58//example.com/)', '<a href="https&#58//example.com/">home</a>'],
  ])('keeps %s', (_description, source, expectedAnchor) => {
    expect(renderMarkdown(source)).toContain(expectedAnchor);
  });

  test('keeps a relative image', () => {
    const html = renderMarkdown('![a diagram](./picture.png)');

    expect(html).toContain('<img src="./picture.png"');
  });

  test('renders the same body identically on a second call, since the parser is reused', () => {
    const body = '## Report\n\n- one\n- two\n';

    expect(renderMarkdown(body)).toBe(renderMarkdown(body));
  });
});
