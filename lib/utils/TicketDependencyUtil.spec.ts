/**
 * The questions about ticket dependencies: which ones still hold a ticket back, which tickets are ready to claim, and whether a new list
 * would make tickets wait on each other in a circle. A loop has to be caught before it is written, because no order of work could ever settle it.
 */
import { expect, test } from 'bun:test';

import type { TicketStatus }    from '../constants/Types';
import { TicketDependencyUtil } from './TicketDependencyUtil';

const { dependencyLoopFrom, readyTicketIdsOf, unsettledDependenciesOf } = TicketDependencyUtil;

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
