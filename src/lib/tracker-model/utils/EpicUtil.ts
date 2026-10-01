/** An epic's rules that need no board: whether a key is usable, which colour slot a new epic takes, and the span of its rows. */
import type { EpicSpan }                                                    from '../@types/Epic.ts';
import { EPIC_COLOUR_SLOT_COUNT, EPIC_KEY_PATTERN, FIRST_EPIC_COLOUR_SLOT } from '../constants/EpicFields.ts';

function epicKeyIsWellFormed(key: string): boolean {
  return EPIC_KEY_PATTERN.test(key);
}

function slotIsWellFormed(slot: unknown): slot is number {
  return Number.isInteger(slot) && Number(slot) >= FIRST_EPIC_COLOUR_SLOT && Number(slot) < FIRST_EPIC_COLOUR_SLOT + EPIC_COLOUR_SLOT_COUNT;
}

/** The slot the fewest existing epics use, the lowest on a tie; a stored slot outside the range is not counted. */
function leastUsedSlotOf(existingSlots: readonly number[]): number {
  let chosenSlot  = FIRST_EPIC_COLOUR_SLOT;
  let chosenCount = Number.POSITIVE_INFINITY;
  for (let slot = FIRST_EPIC_COLOUR_SLOT; slot < FIRST_EPIC_COLOUR_SLOT + EPIC_COLOUR_SLOT_COUNT; slot++) {
    const count = existingSlots.filter((existingSlot) => existingSlot === slot).length;
    if (count < chosenCount) {
      chosenSlot  = slot;
      chosenCount = count;
    }
  }
  return chosenSlot;
}

/**
 * Ordered by the instant each stamp names rather than its text, since stamps carry their own offset; the stamps come back as stored.
 * A row that never started is left out; one that started and has no end leaves the span open.
 */
function spanOf(rows: readonly { start: string | null; end: string | null }[]): EpicSpan | null {
  const startedRows = rows.filter((row): row is { start: string; end: string | null } => row.start !== null);
  if (startedRows.length === 0) return null;
  const instantOf = (stamp: string): number => Date.parse(stamp);
  const start     = startedRows.reduce((earliest, row) => (instantOf(row.start) < instantOf(earliest) ? row.start : earliest), startedRows[0]?.start ?? '');
  if (startedRows.some((row) => row.end === null)) return { start, end: null };
  const ends = startedRows.flatMap((row) => row.end ?? []);
  const end  = ends.reduce((latest, stamp) => (instantOf(stamp) > instantOf(latest) ? stamp : latest), ends[0] ?? '');
  return { start, end };
}

export const EpicUtil = {
  epicKeyIsWellFormed,
  leastUsedSlotOf,
  slotIsWellFormed,
  spanOf,
} as const;
