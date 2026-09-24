/**
 * The three wordings an orchestrator reads after every move — a slot free, none free, nothing ready —
 * the cap that keeps a long queue to one line: five ids, then how many more — and the dispatcher's
 * advice, which is what survives a compaction of the orchestrator's context.
 */
import { expect, test } from 'bun:test';

import { NextLineUtil } from './NextLineUtil';

const { composeNextLine, endWithRunningDispatcherNotice } = NextLineUtil;

/** A running dispatcher adds nothing, so the slot and ready wordings are pinned against it. */
const NOTHING_LOW_PRIORITY_OR_HELD = { lowPriorityReadyTicketIds: [], heldTicketIds: [] } as const;

const WITH_THE_DISPATCHER_RUNNING = { dispatcherState: 'running', ...NOTHING_LOW_PRIORITY_OR_HELD } as const;

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
    ...NOTHING_LOW_PRIORITY_OR_HELD,
  })).toBe('Next: 2 of 2 slots free; ready: #003; launch the dispatcher');
});

test('a finished dispatcher with nothing ready needs no launching', () => {
  expect(composeNextLine({
    limit:           2,
    agentsInFlight:  0,
    freeSlots:       2,
    readyTicketIds:  [],
    dispatcherState: 'finished',
    ...NOTHING_LOW_PRIORITY_OR_HELD,
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
    ...NOTHING_LOW_PRIORITY_OR_HELD,
  })).toBe('Next: 2 of 2 slots free; ready: #003; dispatcher stopped: wait for the user\'s go');
});

test('a running dispatcher with tickets ready adds no advice', () => {
  expect(composeNextLine({
    limit:           2,
    agentsInFlight:  1,
    freeSlots:       1,
    readyTicketIds:  ['003'],
    dispatcherState: 'running',
    ...NOTHING_LOW_PRIORITY_OR_HELD,
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
    heldTicketIds:             [],
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
    heldTicketIds:             [],
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
    heldTicketIds:             [],
    dispatcherState:           'stopped',
  })).toBe('Next: 2 of 2 slots free; ready: #009; dispatcher stopped: wait for the user\'s go');
});

// An orchestrator reading `ready:` starts what it names, so a held ticket must never stand in that list.
test('a held ready ticket is left out of ready and named apart as held', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['001', '002', '003'],
    heldTicketIds:  ['002'],
  })).toBe('Next: 2 of 2 slots free; ready: #001, #003; held: #002');
});

test('a held ticket that is not ready is not named, since the line speaks of what could be started', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['003'],
    heldTicketIds:  ['001'],
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});

test('a board whose only ready ticket is held reads as nothing ready and names the held one', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['001'],
    heldTicketIds:  ['001'],
  })).toBe('Next: 2 of 2 slots free; nothing ready; held: #001');
});

// A finished dispatcher relaunched onto a board of held tickets would start nothing, so no launch is advised.
test('a finished dispatcher whose every ready ticket is held advises no launch', () => {
  expect(composeNextLine({
    limit:                     2,
    agentsInFlight:            0,
    freeSlots:                 2,
    readyTicketIds:            ['001'],
    lowPriorityReadyTicketIds: [],
    heldTicketIds:             ['001'],
    dispatcherState:           'finished',
  })).toBe('Next: 2 of 2 slots free; nothing ready; held: #001');
});

test('a finished dispatcher whose only unheld ready ticket is low advises triage, not a launch', () => {
  expect(composeNextLine({
    limit:                     2,
    agentsInFlight:            0,
    freeSlots:                 2,
    readyTicketIds:            ['001', '009'],
    lowPriorityReadyTicketIds: ['009'],
    heldTicketIds:             ['001'],
    dispatcherState:           'finished',
  })).toBe('Next: 2 of 2 slots free; ready: #009; held: #001; only low priority ready: triage, then launch');
});

test('more than five held ready tickets name the first five and count the rest', () => {
  expect(composeNextLine({
    ...WITH_THE_DISPATCHER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5', '6'],
    heldTicketIds:  ['1', '2', '3', '4', '5', '6'],
  })).toBe('Next: 2 of 2 slots free; nothing ready; held: #1, #2, #3, #4, #5 and 1 more');
});

// The moment an orchestrator adds work mid-run is the moment it is tempted to stop the run, which loses the agents in flight.
test('a running dispatcher adds one line after the text telling an orchestrator not to stop it for the change', () => {
  expect(endWithRunningDispatcherNotice('Next: 2 of 2 slots free; ready: #003', 'running')).toBe(
    'Next: 2 of 2 slots free; ready: #003\nDispatcher running: it picks this change up at its next agent\'s return. Never stop or relaunch it for this.',
  );
});

test('a finished or stopped dispatcher leaves the text as it was', () => {
  expect(endWithRunningDispatcherNotice('Next: nothing ready', 'finished')).toBe('Next: nothing ready');
  expect(endWithRunningDispatcherNotice('Next: nothing ready', 'stopped')).toBe('Next: nothing ready');
});
