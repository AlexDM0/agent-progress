/**
 * The mapping's contract only, not the Board's rules, which `Board.displayQueries.spec.ts` pins: one row fact per row at its index, each fact
 * the Board query's answer for that very record, and every position an index into `board.tasks()`. Duplicated ids, bars of a ticket
 * with no file and rows naming a missing ticket are the cases a hand edit produces, so each is pinned not to shift or break the mapping.
 */
import { describe, expect, test } from 'bun:test';

import type { Task }                                from '../../../lib/tracker-model/@types/Task.ts';
import { boardFixture, taskFixture, ticketFixture } from '../../../testing/BoardFixtures.ts';
import { BoardFactsUtil }                           from './BoardFactsUtil.ts';

const REVIEWED_AT = '2026-09-18T21:10:00+02:00';

function reviewBar(id: number, reviewOf: string, changes: Partial<Task> = {}): Task {
  return taskFixture({
    id,
    name:   `Review ${id} #${reviewOf} — Example checkout page`,
    status: 'in-progress',
    reviewOf,
    ...changes,
  });
}

describe('boardFactsOf', () => {
  test('gives one row fact per row, in the order the Board holds them, each the Board query’s answer for that record', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 4, status: 'in-review', ticket: '003' }),
        taskFixture({ id: 2, status: 'delivered', reviewed: REVIEWED_AT }),
        taskFixture({ id: 7, status: 'paused' }),
        reviewBar(9, '003'),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review', task: 4 })],
    });

    const { rows } = BoardFactsUtil.boardFactsOf(board);

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.displayState)).toEqual(board.tasks().map((task) => board.rowDisplayStateOf(task)));
    expect(rows.map((row) => row.deliveredRowCountsAsReviewed)).toEqual(board.tasks().map((task) => board.deliveredRowCountsAsReviewed(task)));
    expect(rows.map((row) => row.displayState)).toEqual(['reviewing', 'delivered', 'paused', 'in-progress']);
  });

  test('names the own row and the review bars by their positions in board.tasks(), not by their ids', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 30, status: 'delivered' }),
        reviewBar(12, '003'),
        taskFixture({ id: 11, status: 'in-review', ticket: '003' }),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review', task: 11 })],
    });

    const { rows, tickets } = BoardFactsUtil.boardFactsOf(board);

    expect(tickets).toEqual([{
      ticketId:           '003',
      ownRowPosition:     2,
      reviewBarPositions: [1],
      displayState:       board.ticketDisplayStateOf('003'),
    }]);
    expect(board.ownRowOf('003')).toBe(board.tasks()[2] ?? null);
    expect(rows[1]?.ownRowPositionOfReviewedTicket).toBe(2);
  });

  test('lists a ticket’s review bars oldest filed first, whatever order the array holds them in', () => {
    const { board } = boardFixture({
      tasks: [
        reviewBar(8, '003'),
        taskFixture({ id: 1, status: 'in-review', ticket: '003' }),
        reviewBar(3, '003', { status: 'delivered' }),
        reviewBar(5, '003', { status: 'delivered' }),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review', task: 1 })],
    });

    const [ticketFacts] = BoardFactsUtil.boardFactsOf(board).tickets;

    expect(ticketFacts?.reviewBarPositions).toEqual([2, 3, 0]);
  });

  test('gives two rows sharing a hand-duplicated id a fact each, read on its own record', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 2, status: 'delivered', reviewed: REVIEWED_AT }),
        taskFixture({ id: 2, status: 'delivered' }),
      ],
    });

    const { rows } = BoardFactsUtil.boardFactsOf(board);

    expect(rows.map((row) => row.deliveredRowCountsAsReviewed)).toEqual([true, false]);
  });

  test('sets the own row’s position on every bar, a bar of a ticket with no file included, and null on every other row', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 1, status: 'in-progress', ticket: '005' }),
        reviewBar(2, '005'),
        taskFixture({ id: 3, status: 'in-review', ticket: '003' }),
        reviewBar(4, '003'),
        taskFixture({
          id:       5,
          name:     '#009 Example review pass',
          ticket:   '009',
          reviewOf: '003',
        }),
        taskFixture({ id: 6 }),
      ],
      tickets: [ticketFixture({ id: '003', status: 'in-review', task: 3 }), ticketFixture({ id: '009' })],
    });

    const { rows, tickets } = BoardFactsUtil.boardFactsOf(board);

    expect(rows.map((row) => row.ownRowPositionOfReviewedTicket)).toEqual([null, 0, null, 2, null, null]);
    expect(tickets.map((ticket) => ticket.ticketId)).toEqual(['003', '009']);
  });

  test('gives a bar reviewing a ticket the Board does not hold a null own row, and lists it under no ticket', () => {
    const { board } = boardFixture({
      tasks:   [reviewBar(1, '007')],
      tickets: [ticketFixture({ id: '003' })],
    });

    const { rows, tickets } = BoardFactsUtil.boardFactsOf(board);

    expect(rows.map((row) => row.ownRowPositionOfReviewedTicket)).toEqual([null]);
    expect(tickets).toEqual([{
      ticketId:           '003',
      ownRowPosition:     null,
      reviewBarPositions: [],
      displayState:       board.ticketDisplayStateOf('003'),
    }]);
  });

  test('maps a row naming a ticket the Board does not hold without throwing', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, status: 'in-review', ticket: '008' })] });

    expect(() => BoardFactsUtil.boardFactsOf(board)).not.toThrow();
    const { rows, tickets } = BoardFactsUtil.boardFactsOf(board);

    expect(rows.map((row) => row.displayState)).toEqual(board.tasks().map((task) => board.rowDisplayStateOf(task)));
    expect(rows.map((row) => row.ownRowPositionOfReviewedTicket)).toEqual([null]);
    expect(tickets).toEqual([]);
  });

  test('gives empty lists for an empty Board', () => {
    expect(BoardFactsUtil.boardFactsOf(boardFixture().board)).toEqual({ rows: [], tickets: [] });
  });
});
