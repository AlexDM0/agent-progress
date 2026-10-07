/**
 * The chip filter rules both pages share. What matters: no chip pressed keeps everything, the chips of one group are alternatives so an item
 * answering to any pressed chip passes, a stored chip whose group is gone is dropped rather than narrowing a view unseen, and toggling
 * presses at the end and releases in place.
 */

import { describe, expect, test } from 'bun:test';

import { ChipFilterUtil } from './ChipFilterUtil.ts';

describe('ChipFilterUtil.pressedChipsKeep', () => {
  test('no chip pressed keeps an item of any group, and of none', () => {
    expect(ChipFilterUtil.pressedChipsKeep(['checkout'], [])).toBe(true);
    expect(ChipFilterUtil.pressedChipsKeep([], [])).toBe(true);
  });

  test('an item passes on any one of its groups being pressed', () => {
    expect(ChipFilterUtil.pressedChipsKeep(['checkout', 'emails'], ['emails'])).toBe(true);
    expect(ChipFilterUtil.pressedChipsKeep(['checkout'], ['emails', 'checkout'])).toBe(true);
  });

  test('an item none of whose groups is pressed is left out', () => {
    expect(ChipFilterUtil.pressedChipsKeep(['checkout'], ['emails'])).toBe(false);
    expect(ChipFilterUtil.pressedChipsKeep([], ['emails'])).toBe(false);
  });
});

describe('ChipFilterUtil.knownPressedChips', () => {
  test('keeps the stored chips still known, in their stored order, and drops the rest', () => {
    expect(ChipFilterUtil.knownPressedChips(['002', 'gone', '001'], new Set(['001', '002']))).toEqual(['002', '001']);
  });
});

describe('ChipFilterUtil.toggledChips', () => {
  test('presses a released chip at the end and releases a pressed one in place', () => {
    expect(ChipFilterUtil.toggledChips(['001'], '002')).toEqual(['001', '002']);
    expect(ChipFilterUtil.toggledChips(['001', '002', '003'], '002')).toEqual(['001', '003']);
  });
});
