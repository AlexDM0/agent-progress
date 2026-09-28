/**
 * The reported token counts grouped per owner, case-insensitively on the trimmed owner text and shown under its most common spelling,
 * since the owner is free text an orchestrator types; reported rows without an owner are summed apart.
 */
import type { Task } from '../../../src/lib/tracker-model/@types/Task.ts';

export interface OwnerTokenTotal {
  owner:  string;
  tokens: number;
  rows:   number;
}

export interface OwnerTokenTotals {
  owners:        OwnerTokenTotal[];
  withoutOwner:  { tokens: number; rows: number };
  withoutTokens: { rows: number };
}

interface OwnerGroup {
  spellingCounts: Map<string, number>;
  tokens:         number;
  rows:           number;
}

/** Ties go to the spelling met first, as a `Map` keeps insertion order. */
function mostCommonSpellingOf(spellingCounts: ReadonlyMap<string, number>): string {
  let mostCommon      = '';
  let mostCommonCount = 0;
  for (const [spelling, count] of spellingCounts) {
    if (count > mostCommonCount) {
      mostCommon      = spelling;
      mostCommonCount = count;
    }
  }
  return mostCommon;
}

/** Most tokens first; equal totals keep the order their owners first reported in. */
export function ownerTokenTotalsOf(tasks: readonly Readonly<Task>[]): OwnerTokenTotals {
  const groups       = new Map<string, OwnerGroup>();
  const withoutOwner = { tokens: 0, rows: 0 };
  let rowsWithoutTokens = 0;

  for (const task of tasks) {
    if (task.tokens === null) {
      rowsWithoutTokens++;
      continue;
    }
    const spelling = task.owner.trim();
    if (spelling === '') {
      withoutOwner.tokens += task.tokens;
      withoutOwner.rows++;
      continue;
    }
    const groupKey = spelling.toLowerCase();
    const group    = groups.get(groupKey) ?? { spellingCounts: new Map<string, number>(), tokens: 0, rows: 0 };
    group.spellingCounts.set(spelling, (group.spellingCounts.get(spelling) ?? 0) + 1);
    group.tokens += task.tokens;
    group.rows++;
    groups.set(groupKey, group);
  }

  const owners = [...groups.values()]
    .map((group) => ({ owner: mostCommonSpellingOf(group.spellingCounts), tokens: group.tokens, rows: group.rows }))
    .toSorted((a, b) => b.tokens - a.tokens);
  return { owners, withoutOwner, withoutTokens: { rows: rowsWithoutTokens } };
}
