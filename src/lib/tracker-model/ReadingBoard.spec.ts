/**
 * The Board the reading commands build. What they rely on: its queries answer over exactly the records handed in, and a logged change
 * made through it leaves nothing behind but its return value: the progress file is as it was and no ticket is reported changed.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import { readingBoardOf }                           from './ReadingBoard.ts';

test('its queries answer over the progress file and the tickets handed in', () => {
  const { progress, tickets } = boardFixture({
    tasks:            [taskFixture({ id: 1, status: 'in-progress' })],
    tickets:          [ticketFixture({ id: '001' }), ticketFixture({ id: '002', hold: '' })],
    concurrencyLimit: 2,
  });
  const board = readingBoardOf(progress, tickets, []);

  expect(board.concurrency()).toEqual({ limit: 2, agentsInFlight: 1, freeSlots: 1 });
  expect(board.readyTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['001', '002']);
  expect(board.heldTicketIds()).toEqual(['002']);
});

test('a note logged through it returns its record, and leaves the progress file as it was and no ticket changed', () => {
  const { progress, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
  const progressBefore        = structuredClone(progress);
  const board                 = readingBoardOf(progress, tickets, []);

  const { logged } = board.recordNote('Example note', '2026-09-26T10:00:00+02:00');

  expect(logged).toHaveLength(1);
  expect(progress).toEqual(progressBefore);
  expect(board.changedTickets()).toEqual([]);
});
