/**
 * A review counts as in flight on any row storing `reviewOf`, as a claim counts it, and a ticket waits for review exactly while no
 * reviewer is at work; a ticket's linked row is the one its frontmatter `task` names.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';

describe('the ticket ids in flight', () => {
  test('come once each in row order, from in-progress rows that belong to a ticket only', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 1, status: 'in-progress', ticket: '003' }),
        taskFixture({ id: 2, status: 'paused', ticket: '001' }),
        taskFixture({ id: 3, status: 'in-review', ticket: '004' }),
        taskFixture({ id: 4, status: 'in-progress' }),
        taskFixture({ id: 5, status: 'in-progress', ticket: '002' }),
        taskFixture({ id: 6, status: 'in-progress', ticket: '003' }),
      ],
    });

    expect(board.inProgressTicketIds()).toEqual(['003', '002']);
  });
});

describe('the review-of ids in flight', () => {
  // A ticket-owned row storing `reviewOf` blocks a claim and is closed by a move out of review, so it is a reviewer at work here too.
  test('include a ticket-owned in-progress row storing reviewOf, once each in row order', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({
          id: 1, status: 'in-progress', ticket: '005', reviewOf: '002' 
        }),
        taskFixture({
          id: 2, status: 'in-progress', reviewOf: '001', reviewBarRound: 1 
        }),
        taskFixture({
          id: 3, status: 'in-progress', reviewOf: '002', reviewBarRound: 1 
        }),
      ],
    });

    expect(board.inProgressReviewOfIds()).toEqual(['002', '001']);
  });

  test('skip a delivered or paused bar', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({
          id: 1, status: 'delivered', reviewOf: '001', reviewBarRound: 1 
        }),
        taskFixture({
          id: 2, status: 'paused', reviewOf: '002', reviewBarRound: 1 
        }),
      ],
    });

    expect(board.inProgressReviewOfIds()).toEqual([]);
  });
});

describe('the rows reviewing a ticket', () => {
  // A dispatcher's reviewer and parking agent read these, so they must match what counts as a review in flight.
  test('are every row storing its reviewOf, a ticket-owned one and a delivered one included, oldest filed first', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({
          id: 4, status: 'in-progress', reviewOf: '001', reviewBarRound: 2
        }),
        taskFixture({
          id: 3, status: 'in-progress', ticket: '005', reviewOf: '001'
        }),
        taskFixture({
          id: 1, status: 'delivered', reviewOf: '001', reviewBarRound: 1
        }),
        taskFixture({ id: 2, status: 'in-progress', reviewOf: '002' }),
      ],
    });

    expect(board.reviewRowsOf('001').map((task) => task.id)).toEqual([1, 3, 4]);
  });
});

describe('the tickets waiting on a review', () => {
  test('are the in-review tickets no in-progress row reviews, in ticket order', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({
          id: 1, status: 'in-progress', reviewOf: '002', reviewBarRound: 1 
        }),
        taskFixture({
          id: 2, status: 'delivered', reviewOf: '003', reviewBarRound: 1 
        }),
      ],
      tickets: [
        ticketFixture({ id: '001', status: 'in-review', hold: '' }),
        ticketFixture({ id: '002', status: 'in-review' }),
        ticketFixture({ id: '003', status: 'in-review' }),
      ],
    });

    expect(board.reviewWaitingTickets().map((ticket) => ticket.frontmatter.id)).toEqual(['001', '003']);
  });

  test('never list a pending, in-progress or reviewed ticket', () => {
    const { board } = boardFixture({
      tickets: [
        ticketFixture({ id: '001', status: 'pending' }),
        ticketFixture({ id: '002', status: 'in-progress' }),
        ticketFixture({ id: '003', status: 'reviewed' }),
      ],
    });

    expect(board.reviewWaitingTickets()).toEqual([]);
  });

  // The ticket-owned row is no review bar, yet it is a reviewer at work, so the ticket is not handed to a second one.
  test('leave out a ticket its own in-progress row stores reviewOf for', () => {
    const { board } = boardFixture({
      tasks: [taskFixture({
        id: 1, status: 'in-progress', ticket: '001', reviewOf: '001' 
      })],
      tickets: [ticketFixture({ id: '001', status: 'in-review', task: 1 })],
    });

    expect(board.reviewWaitingTickets()).toEqual([]);
  });
});

describe('the row a ticket links', () => {
  test('is the row its frontmatter task names, even when an earlier row names the ticket', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 1, ticket: '001' }),
        taskFixture({ id: 2, ticket: '001' }),
      ],
      tickets: [ticketFixture({ id: '001', task: 2 })],
    });

    expect(board.linkedRowOf('001')?.id).toBe(2);
    expect(board.ownRowOf('001')?.id).toBe(1);
  });

  test('is null for a ticket without one, and for one naming a row that is gone', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, ticket: '001' })],
      tickets: [ticketFixture({ id: '001', task: null }), ticketFixture({ id: '002', task: 7 })],
    });

    expect(board.linkedRowOf('001')).toBeNull();
    expect(board.linkedRowOf('002')).toBeNull();
  });
});

// A query that marked a ticket would have a mutating command that asked it rewrite a ticket file nothing changed.
test('none of these queries changes a record or marks a ticket changed', () => {
  const fixture = boardFixture({
    tasks:   [taskFixture({ id: 1, status: 'in-progress', ticket: '001' }), taskFixture({ id: 2, status: 'in-progress', reviewOf: '002' })],
    tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 }), ticketFixture({ id: '002', status: 'in-review' })],
  });
  const progressAsRead = structuredClone(fixture.progress);
  const ticketsAsRead  = structuredClone(fixture.tickets);
  const { board }      = fixture;

  board.inProgressTicketIds();
  board.inProgressReviewOfIds();
  board.reviewWaitingTickets();
  board.reviewRowsOf('002');
  board.linkedRowOf('001');

  expect(fixture.progress).toEqual(progressAsRead);
  expect(fixture.tickets).toEqual(ticketsAsRead);
  expect(board.changedTickets()).toEqual([]);
});
