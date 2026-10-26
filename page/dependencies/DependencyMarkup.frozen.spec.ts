/**
 * The Waves tab's graph, frozen before its markup moved onto the wave graph both pages share. A moved attribute or a lost space would
 * pass the behaviour specs' substring checks, so `MARKUP`, `HELD_AND_LOW_MARKUP`, a reviewed base under an in-review ticket and the empty
 * line are held byte for byte. Taken at 45bf683 by running `page/testing/DependencyGraphFrozenCases.ts`; retake only in a commit meant to
 * change the graph, with `bun -e 'import { dependencyGraphFrozenCases } from "./page/testing/DependencyGraphFrozenCases.ts"; await
 * Bun.write("page/testing/FrozenDependencyGraphs.json", JSON.stringify(dependencyGraphFrozenCases(), null, 2) + "\n")'` at the repository
 * root.
 */

import { describe, expect, test } from 'bun:test';

import { dependencyGraphFrozenCases } from '../testing/DependencyGraphFrozenCases.ts';

const frozenGraphs: Record<string, string> = await Bun.file(`${import.meta.dir}/../testing/FrozenDependencyGraphs.json`).json();

const currentGraphs = dependencyGraphFrozenCases();

describe('the dependency graph, frozen', () => {
  test('the frozen table holds the two chains, the held and low board, the reviewed base and the empty line', () => {
    expect(Object.keys(frozenGraphs).toSorted()).toEqual(['empty', 'forecastWaves', 'heldAndLow', 'reviewedAndInReview', 'twoChainsOnADeliveredBase']);
  });

  for (const [caseName, frozenMarkup] of Object.entries(frozenGraphs)) {
    test(`${caseName} matches its frozen markup`, () => {
      expect(currentGraphs[caseName]).toEqual(frozenMarkup);
    });
  }
});
