/**
 * Both ends of the token-count contract: what `parseTokenCount` accepts and refuses, and what
 * `formatTokenCount` writes back, including the round trip between the two.
 */
import { expect, test } from 'bun:test';

import { TokenCountUtil } from './TokenCountUtil';

const { formatTokenCount, parseTokenCount } = TokenCountUtil;

test('a plain whole number is the count itself', () => {
  expect(parseTokenCount('12000')).toBe(12_000);
  expect(parseTokenCount('0')).toBe(0);
});

test('a k suffix multiplies by a thousand and an m suffix by a million, in either casing', () => {
  expect(parseTokenCount('12k')).toBe(12_000);
  expect(parseTokenCount('12K')).toBe(12_000);
  expect(parseTokenCount('2m')).toBe(2_000_000);
  expect(parseTokenCount('2M')).toBe(2_000_000);
});

test('a decimal is read against the suffix it carries', () => {
  expect(parseTokenCount('12.3k')).toBe(12_300);
  expect(parseTokenCount('1.2m')).toBe(1_200_000);
});

/** A whole-number check on the scaled value would refuse this: `1.1 * 1000` is `1100.0000000000002`. */
test('a decimal whose product is not exactly representable is still read as the count that was meant', () => {
  expect(parseTokenCount('1.1k')).toBe(1100);
  expect(parseTokenCount('0.1k')).toBe(100);
});

test('a decimal without a suffix is refused, because a fraction of a token is not a thing', () => {
  expect(parseTokenCount('12.5')).toBeNull();
});

test('a negative count is refused rather than read as a small one', () => {
  expect(parseTokenCount('-1')).toBeNull();
  expect(parseTokenCount('-12k')).toBeNull();
});

test('anything that is not a count at all is refused', () => {
  for (const written of ['', '   ', 'lots', '12g', '1,200', '12k5', '1.2.3k', 'k']) {
    expect(parseTokenCount(written), written).toBeNull();
  }
});

test('surrounding whitespace and a space before the suffix are tolerated', () => {
  expect(parseTokenCount('  12k ')).toBe(12_000);
  expect(parseTokenCount('12 k')).toBe(12_000);
});

test('a count under a thousand is shown as it is, since rounding it would lose its only precision', () => {
  expect(formatTokenCount(950)).toBe('950');
  expect(formatTokenCount(0)).toBe('0');
  expect(formatTokenCount(999)).toBe('999');
});

test('thousands are shortened to one decimal place, and a round thousand drops the decimal', () => {
  expect(formatTokenCount(12_345)).toBe('12.3k');
  expect(formatTokenCount(12_000)).toBe('12k');
  expect(formatTokenCount(1000)).toBe('1k');
});

test('millions are shortened the same way, with the upper-case suffix every model dashboard uses', () => {
  expect(formatTokenCount(1_234_567)).toBe('1.2M');
  expect(formatTokenCount(2_000_000)).toBe('2M');
});

test('a count that rounds up to a full thousand of its unit is promoted to the next unit', () => {
  expect(formatTokenCount(999_999)).toBe('1M');
});

test('a parsed count writes back as the shorthand it was written in', () => {
  for (const written of ['12.3k', '1.2M', '950']) {
    expect(formatTokenCount(parseTokenCount(written) ?? -1), written).toBe(written);
  }
});
