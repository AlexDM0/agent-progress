const OVERFLOW_TOLERANCE_PIXELS = 1;

/** `start`, `end`, both space-separated, or `null` when the board fits: the directions the board can still scroll. */
function overflowDirectionsOf(scrollLeft: number, scrollWidth: number, clientWidth: number): string | null {
  const scrollableWidth = scrollWidth - clientWidth;
  const directions      = [
    ...scrollLeft > OVERFLOW_TOLERANCE_PIXELS ? ['start'] : [],
    ...scrollLeft < scrollableWidth - OVERFLOW_TOLERANCE_PIXELS ? ['end'] : [],
  ];
  return directions.length === 0 ? null : directions.join(' ');
}

export const KanbanOverflowUtil = { overflowDirectionsOf } as const;
