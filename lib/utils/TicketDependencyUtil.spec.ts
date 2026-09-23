/**
 * The questions about ticket dependencies: which ones still hold a ticket back, which tickets are ready to claim and in what priority order
 * (low work held back while any normal or high ticket is owed something), and whether a new list
 * would make tickets wait on each other in a circle. A loop has to be caught before it is written, because no order of work could ever settle it.
 */
import { expect, test } from 'bun:test';

import type { TicketStatus }    from '../constants/Types';
import { TicketDependencyUtil } from './TicketDependencyUtil';

const {
  dependencyLoopFrom,
  readyTicketIdsOf,
  ticketsHoldingBackLowPriorityWork,
  unsettledDependenciesOf,
} = TicketDependencyUtil;

const STATUS_BY_ID = new Map<string, TicketStatus>([
  ['001', 'done'],
  ['002', 'delivered'],
  ['003', 'in-progress'],
  ['004', 'abandoned'],
]);

test('a done or delivered ticket settles a dependency, and every other status keeps the ticket waiting', () => {
  expect(unsettledDependenciesOf(['001', '002', '003'], STATUS_BY_ID)).toEqual(['003']);
});

// Abandoned work did not produce what the dependent ticket was waiting for, so the wait stays visible.
test('an abandoned dependency still holds the ticket back', () => {
  expect(unsettledDependenciesOf(['004'], STATUS_BY_ID)).toEqual(['004']);
});

test('a dependency on a ticket that cannot be found counts as unsettled', () => {
  expect(unsettledDependenciesOf(['009'], STATUS_BY_ID)).toEqual(['009']);
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
test('only an open ticket whose every dependency is done or delivered is ready, and the ids come back lowest first', () => {
  const tickets = [
    { id: '010', status: 'open' as const },
    { id: '002', status: 'delivered' as const },
    { id: '003', status: 'open' as const, dependsOn: ['002'] },
    { id: '004', status: 'open' as const, dependsOn: ['005'] },
    { id: '005', status: 'in-progress' as const },
    { id: '006', status: 'open' as const, dependsOn: ['009'] },
  ];

  expect(readyTicketIdsOf(tickets)).toEqual(['003', '010']);
});

// A dispatcher takes the first ready id, so the order is the priority: high work filed late still goes first.
test('a high ticket is listed before every normal one, and each priority is lowest id first within itself', () => {
  const tickets = [
    { id: '001', status: 'open' as const },
    { id: '002', status: 'open' as const, priority: 'high' as const },
    { id: '003', status: 'open' as const, priority: 'normal' as const },
    { id: '004', status: 'open' as const, priority: 'high' as const },
  ];

  expect(readyTicketIdsOf(tickets)).toEqual(['002', '004', '001', '003']);
});

// Low tickets are the reviewers' side findings: they wait until everything the user asked for is merged or dropped, not merely unblocked.
test('a low ticket is ready only once no normal or high ticket is left that is not delivered or abandoned', () => {
  const lowTicket = { id: '001', status: 'open' as const, priority: 'low' as const };

  expect(readyTicketIdsOf([lowTicket, { id: '002', status: 'open' as const }])).toEqual(['002']);
  expect(readyTicketIdsOf([lowTicket, { id: '002', status: 'done' as const }])).toEqual([]);
  expect(readyTicketIdsOf([lowTicket, { id: '002', status: 'delivered' as const }, { id: '003', status: 'abandoned' as const }])).toEqual(['001']);
  expect(readyTicketIdsOf([lowTicket, { id: '002', status: 'open' as const, priority: 'low' as const }])).toEqual(['001', '002']);
});

test('the tickets holding low work back are the normal and high ones still owed something, lowest id first', () => {
  const tickets = [
    { id: '005', status: 'in-review' as const, priority: 'high' as const },
    { id: '002', status: 'done' as const },
    { id: '003', status: 'delivered' as const },
    { id: '004', status: 'open' as const, priority: 'low' as const },
  ];

  expect(ticketsHoldingBackLowPriorityWork(tickets)).toEqual(['002', '005']);
});
