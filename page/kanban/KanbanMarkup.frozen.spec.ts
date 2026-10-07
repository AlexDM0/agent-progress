/**
 * The whole tracker Kanban board, frozen before it moved onto the shared lane board and card renderers. The placeholder suite holds three
 * cards and two lanes; this holds every lane, To do by priority and by wave, Abandoned closed and open, the Done paging footer and hidden
 * line, and every empty text, byte for byte. Taken at 9802bfd (main) by running `page/testing/KanbanBoardFrozenCases.ts`; retake only in a
 * commit meant to change the board's markup, with `bun -e 'import { kanbanBoardFrozenCases } from "./page/testing/KanbanBoardFrozenCases.ts";
 * await Bun.write("page/testing/FrozenKanbanBoards.json", JSON.stringify(kanbanBoardFrozenCases(), null, 2) + "\n")'` at the repository root.
 */

import { describe, expect, test } from 'bun:test';

import { kanbanBoardFrozenCases } from '../testing/KanbanBoardFrozenCases.ts';

const frozenBoards: Record<string, string> = await Bun.file(`${import.meta.dir}/../testing/FrozenKanbanBoards.json`).json();

const currentBoards = kanbanBoardFrozenCases();

describe('the whole board, frozen', () => {
  test('draws the same views the table froze', () => {
    expect(Object.keys(currentBoards)).toEqual(Object.keys(frozenBoards));
  });

  for (const [view, frozenMarkup] of Object.entries(frozenBoards)) {
    test(`matches the frozen board: ${view}`, () => {
      expect(currentBoards[view]).toBe(frozenMarkup);
    });
  }
});
