/**
 * The one JSON layout the tool prints and stores. What callers rely on is the two-space indent every stored file already holds, so a
 * rewrite stays byte for byte, and that a stored file ends with a newline while printed output does not, since a script parses the latter.
 */
import { expect, test } from 'bun:test';

import { JsonTextUtil } from './JsonTextUtil.ts';

test('printed JSON is indented by two spaces and has no trailing newline', () => {
  expect(JsonTextUtil.indentedTextOf({ id: '0001', tags: ['a'] })).toBe('{\n  "id": "0001",\n  "tags": [\n    "a"\n  ]\n}');
});

test('a stored file is the same indented text followed by one newline', () => {
  expect(JsonTextUtil.storedFileTextOf({ installVersion: 3 })).toBe('{\n  "installVersion": 3\n}\n');
});
