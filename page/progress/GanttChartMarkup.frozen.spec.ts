/**
 * The tracker page's chart rows, frozen before `taskRowsMarkup` moved onto the structural chart row source shared with the spec page. A
 * changed attribute, class or order would pass the behaviour specs' substring checks, so each board's rows are held byte for byte. Taken
 * at 37a26ae (`ticket-257`, the group's tip at the time), retaken on `ticket-278` (the number cell naming the ticket), by running
 * `page/testing/GanttChartFrozenCases.ts`; retake only in a commit meant to change the chart rows, with `bun -e 'import { ganttChartFrozenCases } from
 * "./page/testing/GanttChartFrozenCases.ts"; await Bun.write("page/testing/FrozenGanttChartRows.json",
 * JSON.stringify(ganttChartFrozenCases(), null, 2) + "\n")'` at the repository root.
 */

import { describe, expect, test } from 'bun:test';

import { ganttChartFrozenCases } from '../testing/GanttChartFrozenCases.ts';

const frozenRows: Record<string, string> = await Bun.file(`${import.meta.dir}/../testing/FrozenGanttChartRows.json`).json();

const currentRows = ganttChartFrozenCases();

describe('the chart rows, frozen', () => {
  test('the table holds every case, each drawing rows', () => {
    expect(Object.keys(frozenRows)).toEqual(Object.keys(currentRows));
    expect(Object.values(frozenRows).every((markup) => markup.includes('ap-row'))).toBe(true);
  });

  for (const [caseName, frozenMarkup] of Object.entries(frozenRows)) {
    test(`${caseName} matches its frozen rows`, () => {
      expect(currentRows[caseName]).toBe(frozenMarkup);
    });
  }
});
