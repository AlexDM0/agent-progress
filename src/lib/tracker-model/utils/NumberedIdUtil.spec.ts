/**
 * Prefixed ids counted by a stored counter. What matters: only `<prefix><n>` with no leading zero reads as a number; an allocation never
 * goes below the counter nor onto a live id; and an id below the counter that is not live reads as closed, any other as unknown.
 */
import { expect, test } from 'bun:test';

import { NumberedIdUtil } from './NumberedIdUtil.ts';

const { numberOf, allocatedNumberOf, wasClosed } = NumberedIdUtil;

test.each<[string, number | null]>([
  ['E1', 1],
  ['E42', 42],
  ['E0', null],
  ['E01', null],
  ['I1', null],
  ['E', null],
  ['E1a', null],
])('%s reads as %p under the prefix E', (id, number) => {
  expect(numberOf(id, 'E')).toBe(number);
});

test('an allocation takes the counter, the first number with none stored, or one past the highest live id', () => {
  expect(allocatedNumberOf(5, 1, [], 'E')).toBe(5);
  expect(allocatedNumberOf(undefined, 1, [], 'E')).toBe(1);
  expect(allocatedNumberOf(2, 1, ['E7', 'example'], 'E')).toBe(8);
});

test('an id below the counter is closed, one at or above it or of another form is not', () => {
  expect(wasClosed('E3', 'E', 4, 1)).toBe(true);
  expect(wasClosed('E4', 'E', 4, 1)).toBe(false);
  expect(wasClosed('E1', 'E', undefined, 1)).toBe(false);
  expect(wasClosed('I1', 'E', 4, 1)).toBe(false);
});
