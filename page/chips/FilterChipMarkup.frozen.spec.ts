/**
 * The status, type and epic filter chips, frozen before all three moved onto `filterChipMarkup`. A moved attribute, a lost lane dot or
 * swatch, or a changed space before the count would pass the behaviour specs' substring checks, so each row is held byte for byte. Taken at
 * 9802bfd (main) by running `page/testing/FilterChipFrozenCases.ts`; retake only in a commit meant to change the chips, with `bun -e 'import
 * { filterChipFrozenCases } from "./page/testing/FilterChipFrozenCases.ts"; await Bun.write("page/testing/FrozenFilterChips.json",
 * JSON.stringify(filterChipFrozenCases(), null, 2) + "\n")'` at the repository root.
 */

import { describe, expect, test } from 'bun:test';

import { filterChipFrozenCases } from '../testing/FilterChipFrozenCases.ts';

const frozenChips: Record<string, string> = await Bun.file(`${import.meta.dir}/../testing/FrozenFilterChips.json`).json();

const currentChips = filterChipFrozenCases();

describe('the filter chips, frozen', () => {
  test('the table holds the status, type and epic chip rows', () => {
    expect(Object.keys(frozenChips).toSorted()).toEqual(['epicFilterChipsMarkup', 'statusChipsMarkup', 'typeChipsMarkup']);
  });

  for (const [functionName, frozenOutput] of Object.entries(frozenChips)) {
    test(`${functionName} matches its frozen output`, () => {
      expect(currentChips[functionName]).toEqual(frozenOutput);
    });
  }
});
