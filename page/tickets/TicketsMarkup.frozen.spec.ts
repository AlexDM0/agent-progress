/**
 * The Tickets tab's table, frozen before its search marks, empty row, group row and badge moved onto the parts the spec page shares. A
 * moved attribute, a lost space or a changed colspan would pass the behaviour specs' substring checks, so each case is held byte for byte.
 * Taken at f6b16c9 by running `page/testing/TicketTableFrozenCases.ts`; retake only in a commit meant to change the table, with `bun -e
 * 'import { ticketTableFrozenCases } from "./page/testing/TicketTableFrozenCases.ts"; await Bun.write("page/testing/FrozenTicketTables.json",
 * JSON.stringify(ticketTableFrozenCases(), null, 2) + "\n")'` at the repository root.
 */

import { describe, expect, test } from 'bun:test';

import { ticketTableFrozenCases } from '../testing/TicketTableFrozenCases.ts';

const frozenTables: Record<string, Record<string, string>> = await Bun.file(`${import.meta.dir}/../testing/FrozenTicketTables.json`).json();

const currentTables = ticketTableFrozenCases();

describe('the tickets table, frozen', () => {
  test('the table holds the chips, the ungrouped and grouped rows and the empty row', () => {
    expect(Object.keys(frozenTables).toSorted()).toEqual(['chips', 'emptyRow', 'groupedRows', 'ungroupedRows']);
  });

  for (const [partName, frozenCases] of Object.entries(frozenTables)) {
    for (const [caseName, frozenOutput] of Object.entries(frozenCases)) {
      test(`${partName}, ${caseName}, matches its frozen output`, () => {
        expect((currentTables[partName] as Record<string, string>)[caseName]).toEqual(frozenOutput);
      });
    }
  }
});
