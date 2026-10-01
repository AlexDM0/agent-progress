/**
 * The board-free epic rules. The key check guards the file name, so its edges matter: no capitals, no leading, trailing or doubled hyphen.
 * The slot choice is the stored colour, so a tie must always resolve to the same slot; the span tests live with the roll-up in
 * `src/lib/tracker-model/Board.epics.spec.ts`, beside the rows they are taken from.
 */
import { expect, test } from 'bun:test';

import { EpicUtil } from './EpicUtil.ts';

test('a key is lower-case words of letters and digits joined by single hyphens', () => {
  for (const key of ['checkout-redesign', 'search', 'q4-2026']) expect(EpicUtil.epicKeyIsWellFormed(key), key).toBe(true);
  for (const key of ['', 'Checkout', 'checkout_redesign', '-search', 'search-', 'check--out', 'check out', 'kassa/redesign']) {
    expect(EpicUtil.epicKeyIsWellFormed(key), key).toBe(false);
  }
});

test('a slot is a whole number from 1 to 6', () => {
  for (const slot of [1, 6]) expect(EpicUtil.slotIsWellFormed(slot)).toBe(true);
  for (const slot of [0, 7, 2.5, '3', null]) expect(EpicUtil.slotIsWellFormed(slot)).toBe(false);
});

test('a new epic takes the slot the fewest epics use, the lowest on a tie', () => {
  expect(EpicUtil.leastUsedSlotOf([])).toBe(1);
  expect(EpicUtil.leastUsedSlotOf([1, 2, 3, 4, 5, 6])).toBe(1);
  expect(EpicUtil.leastUsedSlotOf([1, 1, 2, 3, 4, 5, 6, 6])).toBe(2);
  expect(EpicUtil.leastUsedSlotOf([2, 9])).toBe(1);
});
