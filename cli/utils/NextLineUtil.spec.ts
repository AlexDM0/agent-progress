/**
 * The three wordings an orchestrator reads after every move — a slot free, none free, nothing ready —
 * the cap that keeps a long queue to one line: five ids, then how many more — and the paused runner's
 * advice, which is what survives a compaction of the orchestrator's context — and that a Board's line is composed from its own
 * dispatch capacity, a board that never set a runner state reading as paused there.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../src/testing/BoardFixtures.ts';
import { NextLineUtil }                             from './NextLineUtil.ts';

const { composeNextLine, nextLineOf } = NextLineUtil;

/** A running runner adds nothing, so the slot and ready wordings are pinned against it. */
const NOTHING_HELD = { heldTicketIds: [] } as const;

const WITH_THE_RUNNER_RUNNING = { runnerState: 'running', ...NOTHING_HELD } as const;

test('a free slot and ready tickets name how many of the limit are free and each ready id', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['3', '5'],
  })).toBe('Next: 1 of 2 slots free; ready: #3, #5');
});

// The case an orchestrator must not dispatch into: it names how many agents are in flight rather than a zero of the limit.
test('no free slot says so and counts the agents in flight', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 2,
    freeSlots:      0,
    readyTicketIds: ['3'],
  })).toBe('Next: no slot free (2 agents in flight); ready: #3');
});

test('one agent filling a limit of one is counted in the singular', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          1,
    agentsInFlight: 1,
    freeSlots:      0,
    readyTicketIds: [],
  })).toBe('Next: no slot free (1 agent in flight); nothing ready');
});

test('an empty queue says nothing is ready rather than printing an empty list', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: [],
  })).toBe('Next: 2 of 2 slots free; nothing ready');
});

test('exactly five ready ids are all named, with no count after them', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5'],
  })).toBe('Next: 2 of 2 slots free; ready: #1, #2, #3, #4, #5');
});

test('more than five names the first five and counts the rest', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          3,
    agentsInFlight: 1,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5', '6', '7'],
  })).toBe('Next: 2 of 3 slots free; ready: #1, #2, #3, #4, #5 and 2 more');
});

/** A limit lowered below the agents in flight leaves no slot; the line reports what is in flight, not a negative. */
test('more agents in flight than the limit allows still reads as no slot free', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          1,
    agentsInFlight: 3,
    freeSlots:      0,
    readyTicketIds: [],
  })).toBe('Next: no slot free (3 agents in flight); nothing ready');
});

test('ids are printed as the store holds them, so a padded id keeps its padding', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['003'],
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});

// A board never resumed and one the user paused both wait for the user, however many tickets are filed meanwhile.
test('a paused runner says to wait for the user\'s go even with tickets ready', () => {
  expect(composeNextLine({
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['003'],
    runnerState:    'paused',
    ...NOTHING_HELD,
  })).toBe('Next: 2 of 2 slots free; ready: #003; runner paused: wait for the user\'s go');
});

test('a running runner with tickets ready adds no advice', () => {
  expect(composeNextLine({
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['003'],
    runnerState:    'running',
    ...NOTHING_HELD,
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});

test('a running runner with nothing ready adds no advice', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: [],
  })).toBe('Next: 2 of 2 slots free; nothing ready');
});

// An orchestrator reading `ready:` starts what it names, so a held ticket must never stand in that list.
test('a held ready ticket is left out of ready and named apart as held', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['001', '002', '003'],
    heldTicketIds:  ['002'],
  })).toBe('Next: 2 of 2 slots free; ready: #001, #003; held: #002');
});

test('a held ticket that is not ready is not named, since the line speaks of what could be started', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 1,
    freeSlots:      1,
    readyTicketIds: ['003'],
    heldTicketIds:  ['001'],
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});

test('a board whose only ready ticket is held reads as nothing ready and names the held one', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['001'],
    heldTicketIds:  ['001'],
  })).toBe('Next: 2 of 2 slots free; nothing ready; held: #001');
});

test('a paused runner whose every ready ticket is held still waits for the user\'s go', () => {
  expect(composeNextLine({
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['001'],
    heldTicketIds:  ['001'],
    runnerState:    'paused',
  })).toBe('Next: 2 of 2 slots free; nothing ready; held: #001; runner paused: wait for the user\'s go');
});

test('more than five held ready tickets name the first five and count the rest', () => {
  expect(composeNextLine({
    ...WITH_THE_RUNNER_RUNNING,
    limit:          2,
    agentsInFlight: 0,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5', '6'],
    heldTicketIds:  ['1', '2', '3', '4', '5', '6'],
  })).toBe('Next: 2 of 2 slots free; nothing ready; held: #1, #2, #3, #4, #5 and 1 more');
});

test('a Board with a free slot and one ready ticket names the free slot and that ticket', () => {
  const { board, progress } = boardFixture({
    tasks:            [taskFixture({ id: 1, status: 'in-progress' })],
    tickets:          [ticketFixture({ id: '001' })],
    concurrencyLimit: 2,
  });
  progress.runnerState = 'running';
  expect(nextLineOf(board)).toBe('Next: 1 of 2 slots free; ready: #001');
});

// A board that never set a runner state reads as paused, so a Board's line never advises a launch the user has not given the go for.
test('a Board whose only ready ticket is low, never resumed, waits for the user\'s go', () => {
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'delivered' }), ticketFixture({ id: '002', priority: 'low' })] });
  expect(nextLineOf(board)).toBe('Next: 2 of 2 slots free; ready: #002; runner paused: wait for the user\'s go');
});

test('a Board whose only open normal work is held names its low tickets ready', () => {
  const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '001', hold: 'waiting on the design' }), ticketFixture({ id: '002', priority: 'low' })] });
  progress.runnerState      = 'running';
  expect(nextLineOf(board)).toBe('Next: 2 of 2 slots free; ready: #002; held: #001');
});
