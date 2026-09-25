/**
 * The task column's stored width. The cases that matter: anything but the one stored word reads as the normal width, the toggle
 * returns to where it started, and the key is scoped to one tracker.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_NAME_COLUMN_WIDTH,
  NAME_COLUMN_WIDTH_ATTRIBUTE,
  nameColumnWidthFrom,
  nameColumnWidthStorageKeyFor,
  toggledNameColumnWidth,
} from './page/NameColumnWidth.ts';

describe('nameColumnWidthFrom', () => {
  test.each([
    ['nothing stored', null],
    ['an unknown word', 'huge'],
    ['the default spelled out', 'normal'],
  ])('reads %s as the normal width', (_description, stored) => {
    expect(nameColumnWidthFrom(stored)).toBe(DEFAULT_NAME_COLUMN_WIDTH);
  });

  test('reads the stored word for the widened column as wide', () => {
    expect(nameColumnWidthFrom('wide')).toBe('wide');
  });
});

describe('toggledNameColumnWidth', () => {
  test('widens the normal column and returns the wide one to normal', () => {
    expect(toggledNameColumnWidth(DEFAULT_NAME_COLUMN_WIDTH)).toBe('wide');
    expect(toggledNameColumnWidth('wide')).toBe(DEFAULT_NAME_COLUMN_WIDTH);
  });
});

describe('nameColumnWidthStorageKeyFor', () => {
  test('scopes the key to the tracker, beside the work-visibility key', () => {
    expect(nameColumnWidthStorageKeyFor('tracker-a')).toBe('agent-progress:tracker-a:name-column');
    expect(nameColumnWidthStorageKeyFor('tracker-a')).not.toBe(nameColumnWidthStorageKeyFor('tracker-b'));
  });
});

// The template's CSS override is keyed on this attribute; a rename on one side alone would leave the button doing nothing.
test('names the attribute the template keys its widened column on', async () => {
  const templateText = await Bun.file(`${import.meta.dir}/page/template.html`).text();

  expect(templateText).toContain(`:root[${NAME_COLUMN_WIDTH_ATTRIBUTE}="wide"] { --col-name: var(--col-name-wide); }`);
});
