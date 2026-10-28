/** Ids of the form `<prefix><n>`, counted by a stored counter that never winds back, so a closed record's id is never handed out again. */

function numberOf(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const digits = id.slice(prefix.length);
  return /^[1-9][0-9]*$/.test(digits) ? Number(digits) : null;
}

/** The number to allocate: the stored counter, or one past the highest live id when a hand-edited file left the counter behind. */
function allocatedNumberOf(storedCounter: number | undefined, firstNumber: number, liveIds: readonly string[], prefix: string): number {
  const highestLiveNumber = liveIds.reduce((highest, id) => Math.max(highest, numberOf(id, prefix) ?? 0), 0);
  return Math.max(storedCounter ?? firstNumber, highestLiveNumber + 1);
}

/** A well-formed id below the counter that is no longer live was closed, never unknown. */
function wasClosed(id: string, prefix: string, storedCounter: number | undefined, firstNumber: number): boolean {
  const number = numberOf(id, prefix);
  return number !== null && number < (storedCounter ?? firstNumber);
}

export const NumberedIdUtil = { numberOf, allocatedNumberOf, wasClosed } as const;
