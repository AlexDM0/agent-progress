/**
 * The unreadable entries' list. The cases that matter: one item per entry with its path and its reason, the line only when known, every
 * value escaped once, and nothing at all for no entries.
 */

import { describe, expect, test }  from 'bun:test';
import { unreadableEntriesMarkup } from './UnreadableEntriesMarkup.ts';

describe('unreadableEntriesMarkup', () => {
  test('lists each entry\'s path and reason, with its line when known', () => {
    expect(unreadableEntriesMarkup([
      { relativePath: 'specs/009-example/tasks.md', reason: 'the frontmatter is never closed', line: 3 },
      { relativePath: 'specs/010-example', reason: 'the folder cannot be listed', line: null },
    ])).toBe('<li><code>specs/009-example/tasks.md</code> the frontmatter is never closed (line 3)</li>'
      + '<li><code>specs/010-example</code> the folder cannot be listed</li>');
  });

  test('escapes the path and the reason', () => {
    expect(unreadableEntriesMarkup([{ relativePath: 'specs/<b>.md', reason: 'a & b', line: null }]))
      .toBe('<li><code>specs/&lt;b&gt;.md</code> a &amp; b</li>');
  });

  test('prints nothing for no entries', () => {
    expect(unreadableEntriesMarkup([])).toBe('');
  });
});
