/**
 * The body edit a ticket and an epic share. What matters is that a file never ends up with two line endings: the text takes the body's
 * own, or the frontmatter's when the body holds none, and an append puts exactly one line ending before its text when the body lacks one.
 */
import { expect, test } from 'bun:test';

import { MarkdownBodyUtil } from './MarkdownBodyUtil.ts';

const { editedBodyOf } = MarkdownBodyUtil;

test('a replacement takes the line ending the body already uses', () => {
  expect(editedBodyOf({ body: 'old\r\n' }, { text: 'one\ntwo\n', appends: false })).toBe('one\r\ntwo\r\n');
  expect(editedBodyOf({ body: 'old\n' }, { text: 'one\r\ntwo', appends: false })).toBe('one\ntwo');
});

test('a body holding no line ending takes the frontmatter\'s', () => {
  expect(editedBodyOf({ body: '', lineEnding: '\r\n' }, { text: 'one\ntwo', appends: false })).toBe('one\r\ntwo');
});

test('an append adds one line ending only where the body does not end in one, and an empty append changes nothing', () => {
  expect(editedBodyOf({ body: 'first' }, { text: 'second', appends: true })).toBe('first\nsecond');
  expect(editedBodyOf({ body: 'first\n' }, { text: 'second', appends: true })).toBe('first\nsecond');
  expect(editedBodyOf({ body: '' }, { text: 'second', appends: true })).toBe('second');
  expect(editedBodyOf({ body: 'first' }, { text: '', appends: true })).toBe('first');
});
