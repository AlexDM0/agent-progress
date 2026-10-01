/**
 * The readers every JSON value from the islands and from storage goes through. The cases that matter are the ones `JSON.parse` and a
 * stored value can produce but a cast would let through: an array counted as a record, and `NaN` or `Infinity` counted as a number.
 */

import { describe, expect, test } from 'bun:test';

import { JsonValueUtil } from './JsonValueUtil.ts';

const { valueIsRecord, finiteNumberOrNull, textOrNull } = JsonValueUtil;

describe('valueIsRecord', () => {
  test('accepts an object, and an array too, since both can be indexed by name', () => {
    expect(valueIsRecord({ presetKey: '1h' })).toBe(true);
    expect(valueIsRecord({})).toBe(true);
    expect(valueIsRecord([])).toBe(true);
  });

  test('refuses null and every non-object', () => {
    for (const value of [null, undefined, 'text', 3, Number.NaN, true]) {
      expect(valueIsRecord(value)).toBe(false);
    }
  });
});

describe('finiteNumberOrNull', () => {
  test('passes a finite number through unchanged, zero and negatives included', () => {
    expect(finiteNumberOrNull(15)).toBe(15);
    expect(finiteNumberOrNull(0)).toBe(0);
    expect(finiteNumberOrNull(-0.5)).toBe(-0.5);
  });

  test('reads NaN, either infinity, a numeric string, null and a record as no number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '15', null, undefined, {}, [15]]) {
      expect(finiteNumberOrNull(value)).toBeNull();
    }
  });
});

describe('textListOf', () => {
  test('keeps every text of a list in order and drops the rest; a value that is no list reads as an empty one', () => {
    expect(JsonValueUtil.textListOf(['checkout', 4, null, 'no epic'])).toEqual(['checkout', 'no epic']);
    expect(JsonValueUtil.textListOf('checkout')).toEqual([]);
    expect(JsonValueUtil.textListOf(null)).toEqual([]);
  });
});

describe('textOrNull', () => {
  test('passes a string through unchanged, the empty string included', () => {
    expect(textOrNull('-4h')).toBe('-4h');
    expect(textOrNull('')).toBe('');
  });

  test('reads every non-string as no text', () => {
    for (const value of [null, undefined, 4, Number.NaN, true, {}, ['-4h']]) {
      expect(textOrNull(value)).toBeNull();
    }
  });
});
