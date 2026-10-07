/** What a row of pressed filter chips keeps, on either page: the chips inside one group are alternatives. */

/** No chip pressed keeps everything; an item answering to several chips passes on any one of them. */
function pressedChipsKeep(groupKeys: readonly string[], pressedChips: readonly string[]): boolean {
  return pressedChips.length === 0 || groupKeys.some((groupKey) => pressedChips.includes(groupKey));
}

/** A stored chip whose group has since gone presses nothing, so it cannot narrow a view unseen. */
function knownPressedChips(storedChips: readonly string[], knownKeys: ReadonlySet<string>): string[] {
  return storedChips.filter((chip) => knownKeys.has(chip));
}

/** A pressed chip released, or a released one pressed at the end. */
function toggledChips(pressedChips: readonly string[], chip: string): string[] {
  return pressedChips.includes(chip) ? pressedChips.filter((pressed) => pressed !== chip) : [...pressedChips, chip];
}

export const ChipFilterUtil = Object.freeze({ pressedChipsKeep, knownPressedChips, toggledChips });
