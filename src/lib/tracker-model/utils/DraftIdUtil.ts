/** A draft id is `D` and its number, `D1`, `D2`, …, never padded, so it can never be read as a ticket id. */
const DRAFT_ID_PATTERN = /^D([1-9]\d*)$/;

function draftIdOf(draftNumber: number): string {
  return `D${draftNumber}`;
}

/** Null for anything that is not a well-formed draft id, `D0` and `D01` included, since no id is ever written that way. */
function draftNumberOf(draftId: string): number | null {
  const match = DRAFT_ID_PATTERN.exec(draftId);
  if (match === null) return null;
  const draftNumber = Number(match[1]);
  return Number.isSafeInteger(draftNumber) ? draftNumber : null;
}

export const DraftIdUtil = {
  draftIdOf,
  draftNumberOf,
} as const;
