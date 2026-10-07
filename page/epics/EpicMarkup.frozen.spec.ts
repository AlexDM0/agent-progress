/**
 * All ten `EpicMarkup` exports, frozen before the chips, swatches, squares and roll-up moved onto the shared group marks. A changed
 * attribute or title word would pass the behaviour specs' substring checks, so each output is held byte for byte. Taken at 9802bfd (main)
 * by running `page/testing/EpicMarkFrozenCases.ts`; retake only in a commit meant to change the epic marks, with `bun -e 'import {
 * epicMarkFrozenCases } from "./page/testing/EpicMarkFrozenCases.ts"; await Bun.write("page/testing/FrozenEpicMarks.json",
 * JSON.stringify(epicMarkFrozenCases(), null, 2) + "\n")'` at the repository root.
 */

import { describe, expect, test } from 'bun:test';

import { epicMarkFrozenCases } from '../testing/EpicMarkFrozenCases.ts';
import { EpicMarkup }          from './EpicMarkup.ts';

const frozenMarks: Record<string, unknown> = await Bun.file(`${import.meta.dir}/../testing/FrozenEpicMarks.json`).json();

const currentMarks = epicMarkFrozenCases();

describe('the epic marks, frozen', () => {
  test('the table covers every export of EpicMarkup', () => {
    expect(Object.keys(frozenMarks).toSorted()).toEqual(Object.keys(EpicMarkup).toSorted());
  });

  for (const [exportName, frozenOutput] of Object.entries(frozenMarks)) {
    test(`${exportName} matches its frozen output`, () => {
      expect(currentMarks[exportName]).toEqual(frozenOutput);
    });
  }
});
