/**
 * The Kanban lane rules callers rely on: a card sits in the lane its row's Progress pill names, and the open lanes read by priority and the
 * closed ones newest first.
 */

import { describe, expect, test }              from 'bun:test';
import type { DisplayState, Task, TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority, TicketStatus }   from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { PageTicket }                     from '../../src/shared/@types/PagePayload.ts';
import type { KanbanCard }                     from '../@types/KanbanCard.ts';
import type { KanbanLane }                     from '../constants/KanbanLane.ts';
import {
  cardsInLane,
  kanbanCardsFor,
  laneIsDividedByPriority,
  laneOfState,
} from './KanbanLanes.ts';

const EXAMPLE_TODAY = '2026-09-25';

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'feature',
    status:      'pending',
    filed:       at('08:00'),
    updated:     at('08:00'),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '',
    ...changes,
  };
}

function exampleRow(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example row ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function cardOf(ticket: PageTicket, tasks: readonly Task[], waitingOn: readonly string[] = []): KanbanCard {
  const [card] = kanbanCardsFor([ticket], tasks, new Map([[ticket.id, waitingOn]]));
  if (card === undefined) {
    throw new Error('no card was built');
  }
  return card;
}

describe('which lane a card sits in', () => {
  // Every row state the Progress tab can show, so a card can never land in a lane whose pill disagrees with the chart.
  test.each([
    ['pending', 'pending', 'todo'],
    ['in-progress', 'in-progress', 'progress'],
    ['paused', 'in-progress', 'progress'],
    ['in-review', 'pending', 'review'],
    ['in-review', 'in-review', 'review'],
    ['re-review', 'in-review', 'review'],
    ['reviewed', 'reviewed', 'merge'],
    ['delivered', 'delivered', 'done'],
    ['abandoned', 'abandoned', 'abandoned'],
  ] as Array<[TaskStatus, TicketStatus, KanbanLane]>)('puts a %s row of a %s ticket in %s', (rowStatus, ticketStatus, lane) => {
    const card = cardOf(exampleTicket('007', { status: ticketStatus }), [exampleRow(1, { status: rowStatus, ticket: '007' })]);

    expect(laneOfState(card.state)).toBe(lane);
  });

  test('reads an in-review row of an in-review ticket as reviewing, the pill the Progress tab shows', () => {
    expect(cardOf(exampleTicket('007', { status: 'in-review' }), [exampleRow(1, { status: 'in-review', ticket: '007' })]).state).toBe('reviewing');
  });

  // A low ticket never started has no row; its status alone decides the lane.
  test.each([
    ['pending', 'pending', 'todo'],
    ['in-progress', 'in-progress', 'progress'],
    ['in-review', 'reviewing', 'review'],
    ['reviewed', 'reviewed', 'merge'],
    ['delivered', 'delivered', 'done'],
    ['abandoned', 'abandoned', 'abandoned'],
  ] as Array<[TicketStatus, DisplayState, KanbanLane]>)('puts a %s ticket with no row in state %s and lane %s', (ticketStatus, state, lane) => {
    const card = cardOf(exampleTicket('007', { status: ticketStatus }), []);

    expect(card.ownRow).toBeNull();
    expect(card.state).toBe(state);
    expect(laneOfState(card.state)).toBe(lane);
  });

  test('never takes a review row as the ticket’s own row', () => {
    const reviewRow = exampleRow(2, { status: 'in-progress', reviewOf: '007' });

    expect(cardOf(exampleTicket('007'), [reviewRow]).ownRow).toBeNull();
  });
});

describe('the order within a lane', () => {
  function idsInLane(tickets: readonly PageTicket[], lane: Parameters<typeof cardsInLane>[1]): string[] {
    return cardsInLane(kanbanCardsFor(tickets, [], new Map()), lane).map((card) => card.ticket.id);
  }

  test('runs high, normal, low, then the id as a number, so #9 comes before #10', () => {
    const tickets = [
      exampleTicket('10'),
      exampleTicket('9'),
      exampleTicket('3', { priority: 'low' }),
      exampleTicket('12', { priority: 'high' }),
    ];

    expect(idsInLane(tickets, 'todo')).toEqual(['12', '9', '10', '3']);
  });

  test('divides an open lane only when it holds more than one priority', () => {
    const cardsOfPriorities = (priorities: TicketPriority[]): KanbanCard[] => kanbanCardsFor(
      priorities.map((priority, index) => exampleTicket(String(index + 1), { priority })),
      [],
      new Map(),
    );

    expect(laneIsDividedByPriority('todo', cardsOfPriorities(['normal', 'normal']))).toBe(false);
    expect(laneIsDividedByPriority('todo', cardsOfPriorities(['normal', 'low']))).toBe(true);
    expect(laneIsDividedByPriority('done', cardsOfPriorities(['normal', 'low']))).toBe(false);
  });

  test('puts Done newest first by its delivered stamp, a tie to the higher id', () => {
    const tickets = [
      exampleTicket('004', { status: 'delivered', delivered: at('09:00') }),
      exampleTicket('005', { status: 'delivered', delivered: at('11:00') }),
      exampleTicket('006', { status: 'delivered', delivered: at('09:00') }),
      exampleTicket('003', { status: 'delivered', delivered: at('23:00', '2026-09-24') }),
    ];

    expect(idsInLane(tickets, 'done')).toEqual(['005', '006', '004', '003']);
  });

  test('puts Abandoned newest first by its abandoned stamp, a tie to the higher id', () => {
    const tickets = [
      exampleTicket('004', { status: 'abandoned', abandonedAt: at('09:00') }),
      exampleTicket('002', { status: 'abandoned', abandonedAt: at('10:00') }),
      exampleTicket('008', { status: 'abandoned', abandonedAt: at('09:00') }),
    ];

    expect(idsInLane(tickets, 'abandoned')).toEqual(['002', '008', '004']);
  });
});
