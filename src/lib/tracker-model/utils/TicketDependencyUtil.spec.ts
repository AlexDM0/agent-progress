/**
 * The questions about ticket dependencies: which ones still hold a ticket back, which tickets are ready to claim and in what order
 * (priority, then readiness, then id; priority never holds a ticket back), and whether a new list
 * would make tickets wait on each other in a circle. A loop has to be caught before it is written, because no order of work could ever settle it.
 */
import { expect, test } from 'bun:test';

import type { TicketStatus }    from '../@types/Ticket.ts';
import { TicketDependencyUtil } from './TicketDependencyUtil.ts';

const {
  dependencyLoopFrom,
  readyTicketIdsOf,
  unsettledDependenciesOf,
  waitingOnOf,
} = TicketDependencyUtil;

const STATUS_BY_ID = new Map<string, TicketStatus>([
  ['001', 'reviewed'],
  ['002', 'delivered'],
  ['003', 'in-progress'],
  ['004', 'abandoned'],
]);

test('a reviewed or delivered ticket settles a dependency, and every other status keeps the ticket waiting', () => {
  expect(unsettledDependenciesOf(['001', '002', '003'], STATUS_BY_ID)).toEqual(['003']);
});

// Abandoned work did not produce what the dependent ticket was waiting for, so the wait stays visible.
test('an abandoned dependency still holds the ticket back', () => {
  expect(unsettledDependenciesOf(['004'], STATUS_BY_ID)).toEqual(['004']);
});

test('a dependency on a ticket that cannot be found counts as unsettled', () => {
  expect(unsettledDependenciesOf(['009'], STATUS_BY_ID)).toEqual(['009']);
});

test('a ticket still to be worked on waits on the dependencies not yet reviewed or delivered', () => {
  expect(waitingOnOf({ status: 'pending', dependsOn: ['001', '003'] }, STATUS_BY_ID)).toEqual(['003']);
  expect(waitingOnOf({ status: 'in-progress', dependsOn: ['004'] }, STATUS_BY_ID)).toEqual(['004']);
  expect(waitingOnOf({ status: 'pending' }, STATUS_BY_ID)).toEqual([]);
});

// A closed ticket's list is history; showing it as waiting would suggest work that is not coming.
test('a reviewed, delivered or abandoned ticket waits on nothing, whatever its list holds', () => {
  for (const status of ['reviewed', 'delivered', 'abandoned'] as const) {
    expect(waitingOnOf({ status, dependsOn: ['003', '009'] }, STATUS_BY_ID), status).toEqual([]);
  }
});

test('a list that closes no loop comes back null', () => {
  const dependsOnById = new Map([['002', ['001']], ['003', ['002']]]);

  expect(dependencyLoopFrom('004', ['003'], dependsOnById)).toBeNull();
});

test('a ticket waiting on itself is a loop of one', () => {
  expect(dependencyLoopFrom('001', ['001'], new Map())).toEqual(['001', '001']);
});

test('a loop through other tickets is reported along the path that closes it', () => {
  const dependsOnById = new Map([['002', ['003']], ['003', ['001']]]);

  expect(dependencyLoopFrom('001', ['002'], dependsOnById)).toEqual(['001', '002', '003', '001']);
});

test('the ticket being changed is judged by its new list, not by the one it has on disk', () => {
  const dependsOnById = new Map([['001', ['002']], ['002', []]]);

  expect(dependencyLoopFrom('002', ['001'], dependsOnById)).toEqual(['002', '001', '002']);
});

// What `status --json` hands a dispatcher as claimable: in-progress work and work waiting on anything unfinished must not appear.
test('only a pending ticket whose every dependency is reviewed or delivered is ready, and the ids come back lowest first', () => {
  const tickets = [
    { id: '010', status: 'pending' as const },
    { id: '002', status: 'delivered' as const },
    { id: '003', status: 'pending' as const, dependsOn: ['002'] },
    { id: '004', status: 'pending' as const, dependsOn: ['005'] },
    { id: '005', status: 'in-progress' as const },
    { id: '006', status: 'pending' as const, dependsOn: ['009'] },
  ];

  expect(readyTicketIdsOf(tickets)).toEqual(['003', '010']);
});

// A dispatcher takes the first ready id, so the order is the priority: high work filed late still goes first.
test('a high ticket is listed before every normal one, and each priority is lowest id first within itself', () => {
  const tickets = [
    { id: '001', status: 'pending' as const },
    { id: '002', status: 'pending' as const, priority: 'high' as const },
    { id: '003', status: 'pending' as const, priority: 'normal' as const },
    { id: '004', status: 'pending' as const, priority: 'high' as const },
  ];

  expect(readyTicketIdsOf(tickets)).toEqual(['002', '004', '001', '003']);
});

// Ready means build: priority only orders, so unsettled normal or high work holds no low ticket back.
test('a low ticket is ready beside normal and high work that is still owed, and listed after it', () => {
  const tickets = [
    { id: '001', status: 'pending' as const, priority: 'low' as const },
    { id: '002', status: 'pending' as const },
    { id: '003', status: 'in-review' as const, priority: 'high' as const },
    { id: '004', status: 'reviewed' as const },
  ];

  expect(readyTicketIdsOf(tickets)).toEqual(['002', '001']);
});

test('within a priority the ticket readied earlier comes first, before the id decides', () => {
  const tickets = [
    { id: '001', status: 'pending' as const },
    { id: '002', status: 'pending' as const },
    { id: '003', status: 'pending' as const, priority: 'high' as const },
  ];
  const readinessPositionByTicketId = new Map([['001', 9], ['002', 4], ['003', 12]]);

  expect(readyTicketIdsOf(tickets, readinessPositionByTicketId)).toEqual(['003', '002', '001']);
});

// A ticket readied before readiness was logged, under v16 or behind a clearing, has waited longest.
test('a ticket with no readiness position ranks before every positioned one of its priority, and ids order those without one', () => {
  const tickets = [
    { id: '001', status: 'pending' as const },
    { id: '002', status: 'pending' as const },
    { id: '003', status: 'pending' as const },
    { id: '004', status: 'pending' as const, priority: 'low' as const },
  ];

  expect(readyTicketIdsOf(tickets, new Map([['001', 0], ['004', 1]]))).toEqual(['002', '003', '001', '004']);
});
