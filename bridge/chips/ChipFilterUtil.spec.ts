/**
 * The chip filter rules both pages share. What matters: no chip pressed keeps everything, the chips of one group are alternatives so an item
 * answering to any pressed chip passes, the groups and the search all hold, a group's counts ignore its own pressed chips, a stored chip whose
 * group is gone is dropped rather than narrowing a view unseen, and toggling presses at the end and releases in place.
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

interface ExampleItem {
  readonly spec:  string;
  readonly state: string;
  readonly title: string;
}

const ITEMS: readonly ExampleItem[] = [
  { spec: '001', state: 'done', title: 'Setup' },
  { spec: '001', state: 'to-do', title: 'Polish' },
  { spec: '002', state: 'done', title: 'Wish list' },
  { spec: '002', state: 'in-progress', title: 'Search' },
];

function filtersFor(pressedSpecs: readonly string[], pressedStates: readonly string[]) {
  const spec  = { pressed: pressedSpecs, chipsOf: (item: ExampleItem) => [item.spec] };
  const state = { pressed: pressedStates, chipsOf: (item: ExampleItem) => [item.state] };
  return { spec, state, all: [spec, state] };
}

const everyItem = (): boolean => true;

describe('ChipFilterUtil.itemMatches', () => {
  test('keeps an item passing the search and every group, any chip of a group sufficing', () => {
    const { all } = filtersFor(['001', '002'], ['done']);

    expect(ITEMS.filter((item) => ChipFilterUtil.itemMatches(item, everyItem, all)).map((item) => item.title)).toEqual(['Setup', 'Wish list']);
  });

  test('leaves out an item the search rejects, whatever its chips', () => {
    const { all } = filtersFor([], []);

    expect(ITEMS.filter((item) => ChipFilterUtil.itemMatches(item, (candidate) => candidate.title.includes('Wish'), all)).map((item) => item.title)).toEqual(['Wish list']);
  });
});

describe('ChipFilterUtil.chipCountsOf', () => {
  test('counts a group ignoring its own pressed chips, within the other groups and the search', () => {
    const { spec, state, all } = filtersFor(['001'], ['done']);

    expect([...ChipFilterUtil.chipCountsOf(ITEMS, everyItem, all, state)]).toEqual([['done', 1], ['to-do', 1]]);
    expect([...ChipFilterUtil.chipCountsOf(ITEMS, everyItem, all, spec)]).toEqual([['001', 1], ['002', 1]]);
    expect([...ChipFilterUtil.chipCountsOf(ITEMS, (item) => item.spec === '002', all, spec)]).toEqual([['002', 1]]);
  });

  test('a seeded chip no item answers to counts zero, in the seeded order', () => {
    const { state, all } = filtersFor(['002'], []);

    expect([...ChipFilterUtil.chipCountsOf(ITEMS, everyItem, all, state, ['to-do', 'in-progress', 'done'])]).toEqual([['to-do', 0], ['in-progress', 1], ['done', 1]]);
  });
});
