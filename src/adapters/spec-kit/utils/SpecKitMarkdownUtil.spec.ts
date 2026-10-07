/**
 * The shared line walk. The cases that matter: lines keep their file line numbers through a byte order mark and CRLF endings; HTML
 * comments, single- or multi-line, and fenced code are hidden, since templates keep examples there; a title is looked for only after a
 * frontmatter when one may open the file; and binary content is located by line.
 */
import { expect, test } from 'bun:test';

import { SpecKitMarkdownUtil } from './SpecKitMarkdownUtil.ts';

const { binaryContentLineOf, titledDocumentOf, visibleLinesOf } = SpecKitMarkdownUtil;

test('comments and fenced code are hidden while every other line keeps its number', () => {
  const text = '﻿# Title\r\nkept <!-- hidden --> too\r\n<!--\r\n# not a heading\r\n-->\r\n```\r\n# not either\r\n```\r\nlast\r\n';
  expect(visibleLinesOf(text).filter((line) => line.text !== '')).toEqual([
    { text: '# Title', line: 1 },
    { text: 'kept  too', line: 2 },
    { text: 'last', line: 9 },
  ]);
});

test('a frontmatter comment line is never taken for the title', () => {
  const reading = titledDocumentOf('---\n# a YAML comment\n---\n\n# Tasks: Example Checkout\nbody\n', '# Tasks: [FEATURE NAME]', true);
  expect(reading).toMatchObject({
    verdict:  'parsed',
    document: {
      title: 'Tasks: Example Checkout', fillState: 'filled', titleLine: { line: 5 }, lines: [{ text: 'body', line: 6 }, { text: '', line: 7 }]
    },
  });
});

test('binary content is located by its line, and text without any is null', () => {
  expect(binaryContentLineOf('fine\nalso fine\nbad \u0000 byte\n')).toBe(3);
  expect(binaryContentLineOf('fine\n')).toBeNull();
});
