/**
 * The checks every stored format's validation shares. The cases that matter: an unparseable text's problem is worded as an ingestion reports
 * it, an array or null is never a plain object, and a whole number means a safe integer, so a fraction or a number past the safe range fails.
 */
import { expect, test } from 'bun:test';

import { StoredValueUtil } from './StoredValueUtil.ts';

test('a JSON text parses to its value', () => {
  expect(StoredValueUtil.parsedJsonOf('{ "installVersion": 3 }')).toEqual({ verdict: 'parsed', value: { installVersion: 3 } });
});

test('a text that is not JSON is unparseable, the problem naming the parser message', () => {
  const parsedJson = StoredValueUtil.parsedJsonOf('{ not json');
  expect(parsedJson.verdict).toBe('unparseable');
  expect(parsedJson.verdict === 'unparseable' ? parsedJson.problem : '').toStartWith('it is not valid JSON (');
});

test('only an object that is neither null nor an array is a plain object', () => {
  expect(StoredValueUtil.valueIsAPlainObject({ project: 'Example Agency' })).toBe(true);
  expect(StoredValueUtil.valueIsAPlainObject([])).toBe(false);
  expect(StoredValueUtil.valueIsAPlainObject(null)).toBe(false);
  expect(StoredValueUtil.valueIsAPlainObject('Example Agency')).toBe(false);
});

test('a whole number is a safe integer, negative ones included', () => {
  expect(StoredValueUtil.valueIsAWholeNumber(-4)).toBe(true);
  expect(StoredValueUtil.valueIsAWholeNumber(1.5)).toBe(false);
  expect(StoredValueUtil.valueIsAWholeNumber(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  expect(StoredValueUtil.valueIsAWholeNumber('3')).toBe(false);
});

test('a whole number at least a bound admits the bound itself and nothing below it', () => {
  expect(StoredValueUtil.wholeNumberIsAtLeast(2, 2)).toBe(true);
  expect(StoredValueUtil.wholeNumberIsAtLeast(1, 2)).toBe(false);
  expect(StoredValueUtil.wholeNumberIsAtLeast(2.5, 2)).toBe(false);
});
