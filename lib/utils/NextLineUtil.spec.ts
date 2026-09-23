/**
 * The three wordings an orchestrator reads after every move — a slot free, none free, nothing ready —
 * the cap that keeps a long queue to one line: five ids, then how many more — and the dispatcher's
 * advice, which is what survives a compaction of the orchestrator's context.
 */
import { expect, test } from 'bun:test';

import { NextLineUtil } from './NextLineUtil';

const { composeNextLine } = NextLineUtil;

/** A running dispatcher adds nothing, so the slot and ready wordings are pinned against it. */
const NO_LOW_PRIORITY_READY = { lowPriorityReadyTicketIds: [] } as const;

const WITH_THE_DISPATCHER_RUNNING = { dispatcherState: 'running', ...NO_LOW_PRIORITY_READY } as const;

test('a free slot and ready tickets name how many of the limit are free and each ready id', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['3', '5'],
  })).toBe('Next: 1 of 2 slots free; ready: #3, #5');
});

// The case an orchestrator must not dispatch into: it names how many agents are in flight rather than a zero of the limit.
test('no free slot says so and counts the agents in flight', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 2,
    freeSlots:      0,
    readyTicketIds: ['3'],
  })).toBe('Next: no slot free (2 agents in flight); ready: #3');
});

test('one agent filling a limit of one is counted in the singular', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          1,
    agentsInFlight: 1,
    freeSlots:      0,
    readyTicketIds: [],
  })).toBe('Next: no slot free (1 agent in flight); nothing ready');
});

test('an empty queue says nothing is ready rather than printing an empty list', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: [],
  })).toBe('Next: 2 of 2 slots free; nothing ready');
});

test('exactly five ready ids are all named, with no count after them', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5'],
  })).toBe('Next: 2 of 2 slots free; ready: #1, #2, #3, #4, #5');
});

test('more than five names the first five and counts the rest', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          3,
    agentsInFlight: 1,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5', '6', '7'],
  })).toBe('Next: 2 of 3 slots free; ready: #1, #2, #3, #4, #5 and 2 more');
});

/** A limit lowered below the agents in flight leaves no slot; the line reports what is in flight, not a negative. */
test('more agents in flight than the limit allows still reads as no slot free', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          1,
    agentsInFlight: 3,
    freeSlots:      0,
    readyTicketIds: [],
  })).toBe('Next: no slot free (3 agents in flight); nothing ready');
});

test('ids are printed as the store holds them, so a padded id keeps its padding', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['003'],
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});

// The dispatcher ended by itself; a ticket is waiting, so the orchestrator relaunches it without asking.
test('a finished dispatcher with a ready ticket reads as launch the dispatcher', () => {
  expect(composeNextLine({
    limit:           2,
    agentsInFlight:  0,
    freeSlots:       2,
    readyTicketIds:  ['003'],
    dispatcherState: 'finished',
    ...NO_LOW_PRIORITY_READY,
  })).toBe('Next: 2 of 2 slots free; ready: #003; launch the dispatcher');
});

test('a finished dispatcher with nothing ready needs no launching', () => {
  expect(composeNextLine({
    limit:           2,
    agentsInFlight:  0,
    freeSlots:       2,
    readyTicketIds:  [],
    dispatcherState: 'finished',
    ...NO_LOW_PRIORITY_READY,
  })).toBe('Next: 2 of 2 slots free; nothing ready');
});

// A board never started and one the user stopped both wait for the user, however many tickets are filed meanwhile.
test('a stopped dispatcher says to wait for the user\'s go even with tickets ready', () => {
  expect(composeNextLine({
    limit:           2,
    agentsInFlight:  0,
    freeSlots:       2,
    readyTicketIds:  ['003'],
    dispatcherState: 'stopped',
    ...NO_LOW_PRIORITY_READY,
  })).toBe('Next: 2 of 2 slots free; ready: #003; dispatcher stopped: wait for the user\'s go');
});

test('a running dispatcher with tickets ready adds no advice', () => {
  expect(composeNextLine({
    limit:           2,
    agentsInFlight:  1,
    freeSlots:       1,
    readyTicketIds:  ['003'],
    dispatcherState: 'running',
    ...NO_LOW_PRIORITY_READY,
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});

// Low tickets are triaged before a run is launched for them, so a finished board with only low work left must not read as "launch".
test('a finished dispatcher with only low tickets ready advises triage before a launch', () => {
  expect(composeNextLine({
    limit:                     2,
    agentsInFlight:            0,
    freeSlots:                 2,
    readyTicketIds:            ['007', '009'],
    lowPriorityReadyTicketIds: ['007', '009'],
    dispatcherState:           'finished',
  })).toBe('Next: 2 of 2 slots free; ready: #007, #009; only low priority ready: triage, then launch');
});

test('a finished dispatcher with a normal ticket ready beside a low one reads as launch the dispatcher', () => {
  expect(composeNextLine({
    limit:                     2,
    agentsInFlight:            0,
    freeSlots:                 2,
    readyTicketIds:            ['003', '009'],
    lowPriorityReadyTicketIds: ['009'],
    dispatcherState:           'finished',
  })).toBe('Next: 2 of 2 slots free; ready: #003, #009; launch the dispatcher');
});

test('a stopped dispatcher with only low tickets ready still waits for the user\'s go', () => {
  expect(composeNextLine({
    limit:                     2,
    agentsInFlight:            0,
    freeSlots:                 2,
    readyTicketIds:            ['009'],
    lowPriorityReadyTicketIds: ['009'],
    dispatcherState:           'stopped',
  })).toBe('Next: 2 of 2 slots free; ready: #009; dispatcher stopped: wait for the user\'s go');
});
