/** What rows of pressed filter chips keep, on either page: the chips inside one group are alternatives, the groups and the search all hold. */

/** One chip group over a list of items: the chips pressed in it, and the chips an item answers to. */
export interface ChipFilter<Item, Chip extends string = string> {
  readonly pressed: readonly Chip[];
  chipsOf(item: Item): readonly Chip[];
}

/** No chip pressed keeps everything; an item answering to several chips passes on any one of them. */
function pressedChipsKeep(groupKeys: readonly string[], pressedChips: readonly string[]): boolean {
  return pressedChips.length === 0 || groupKeys.some((groupKey) => pressedChips.includes(groupKey));
}

/** OR inside a chip group, AND across the groups and the search. */
function itemMatches<Item>(item: Item, searchMatches: (item: Item) => boolean, filters: ReadonlyArray<ChipFilter<Item>>): boolean {
  return searchMatches(item) && filters.every((filter) => pressedChipsKeep(filter.chipsOf(item), filter.pressed));
}

/**
 * What pressing each chip of `countedFilter` would show: every item answering to it that passes the search and every other group, so a
 * group's own pressed chips never shrink its counts. A seeded chip counts zero rather than going missing.
 */
function chipCountsOf<Item, Chip extends string>(
  items: readonly Item[],
  searchMatches: (item: Item) => boolean,
  filters: ReadonlyArray<ChipFilter<Item>>,
  countedFilter: ChipFilter<Item, Chip>,
  seededChips: readonly Chip[] = [],
): Map<Chip, number> {
  const counts       = new Map<Chip, number>(seededChips.map((chip) => [chip, 0]));
  const otherFilters = filters.filter((filter) => filter !== countedFilter);
  for (const item of items) {
    if (itemMatches(item, searchMatches, otherFilters)) {
      for (const chip of countedFilter.chipsOf(item)) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
  }
  return counts;
}

/** A stored chip whose group has since gone presses nothing, so it cannot narrow a view unseen. */
function knownPressedChips(storedChips: readonly string[], knownKeys: ReadonlySet<string>): string[] {
  return storedChips.filter((chip) => knownKeys.has(chip));
}

/** A pressed chip released, or a released one pressed at the end. */
function toggledChips(pressedChips: readonly string[], chip: string): string[] {
  return pressedChips.includes(chip) ? pressedChips.filter((pressed) => pressed !== chip) : [...pressedChips, chip];
}

export const ChipFilterUtil = Object.freeze({
  pressedChipsKeep, itemMatches, chipCountsOf, knownPressedChips, toggledChips
});
