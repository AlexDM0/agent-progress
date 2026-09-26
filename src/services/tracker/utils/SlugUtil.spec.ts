/**
 * `slugFromTitle` against the titles that produce a bad file name rather than an ugly one: the slug
 * is never empty and never ends on a hyphen, because a caller builds `${id}-${slug}.md` from it.
 */
import { expect, test } from 'bun:test';

import { SlugUtil } from './SlugUtil';

const { slugFromTitle } = SlugUtil;

test('a plain title becomes its own words, lower case and hyphen separated', () => {
  expect(slugFromTitle('Double-click a role to edit it')).toBe('double-click-a-role-to-edit-it');
});

test('a run of punctuation or whitespace collapses into a single hyphen', () => {
  expect(slugFromTitle('Fix:   the   thing!!')).toBe('fix-the-thing');
});

test('there is never a leading or trailing hyphen, whatever the title started and ended with', () => {
  expect(slugFromTitle('  — Fix the thing —  ')).toBe('fix-the-thing');
  expect(slugFromTitle('###')).toBe('ticket');
});

test('an accented letter is folded to its base letter rather than dropped', () => {
  expect(slugFromTitle('Café façade in Düsseldorf')).toBe('cafe-facade-in-dusseldorf');
});

test('a letter with no decomposition at all becomes a separator rather than vanishing silently', () => {
  // `ß` has no NFKD fold to ASCII, and expanding it to `ss` would be a language rule this module deliberately has none of.
  expect(slugFromTitle('Größer')).toBe('gro-er');
});

test('a title with no ASCII fold at all still produces a name', () => {
  expect(slugFromTitle('日本語')).toBe('ticket');
});

test('an empty or whitespace-only title produces the fallback rather than an empty file name', () => {
  expect(slugFromTitle('')).toBe('ticket');
  expect(slugFromTitle('   ')).toBe('ticket');
});

test('a long title is cut to sixty characters and never ends on a hyphen', () => {
  const longTitle = 'Make the orchestrator register a task before it spawns every subagent it plans to run';
  const slug = slugFromTitle(longTitle);
  expect(slug.length).toBeLessThanOrEqual(60);
  expect(slug.endsWith('-')).toBe(false);
  expect(slug.startsWith('make-the-orchestrator-register-a-task')).toBe(true);
});

test('a title whose sixtieth character falls on a word boundary still loses the hyphen', () => {
  // Constructed so the cut lands exactly on the separator, which is why the trim runs after the cut.
  const title = `${'a'.repeat(59)} tail`;
  expect(slugFromTitle(title)).toBe('a'.repeat(59));
});

test('digits survive, so a title naming a version or an identifier stays searchable', () => {
  expect(slugFromTitle('Upgrade marked to 17')).toBe('upgrade-marked-to-17');
});

test('the result only ever holds lower-case letters, digits and hyphens', () => {
  const awkwardTitles = ['Fix: <b>x</b> & "y"', 'C++ / C# interop', 'path/to/file.ts', '../escape'];
  for (const title of awkwardTitles) {
    expect(slugFromTitle(title), title).toMatch(/^[a-z0-9-]+$/);
  }
});
