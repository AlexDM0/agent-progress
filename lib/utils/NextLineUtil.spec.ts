/**
 * The three wordings an orchestrator reads after every move — a slot free, none free, nothing ready —
 * and the cap that keeps a long queue to one line: five ids, then how many more.
 */
import { expect, test } from 'bun:test';

import { NextLineUtil } from './NextLineUtil';

const { composeNextLine } = NextLineUtil;

test('a free slot and ready tickets name how many of the limit are free and each ready id', () => {
  expect(composeNextLine({
    limit:          2,
    inFlight:       1,
    freeSlots:      1,
    readyTicketIds: ['3', '5'],
  })).toBe('Next: 1 of 2 slots free; ready: #3, #5');
});

// The case an orchestrator must not dispatch into: it names how many are running rather than a zero of the limit.
test('no free slot says so and counts what is running', () => {
  expect(composeNextLine({
    limit:          2,
    inFlight:       2,
    freeSlots:      0,
    readyTicketIds: ['3'],
  })).toBe('Next: no slot free (2 running); ready: #3');
});

test('an empty queue says nothing is ready rather than printing an empty list', () => {
  expect(composeNextLine({
    limit:          2,
    inFlight:       0,
    freeSlots:      2,
    readyTicketIds: [],
  })).toBe('Next: 2 of 2 slots free; nothing ready');
});

test('exactly five ready ids are all named, with no count after them', () => {
  expect(composeNextLine({
    limit:          2,
    inFlight:       0,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5'],
  })).toBe('Next: 2 of 2 slots free; ready: #1, #2, #3, #4, #5');
});

test('more than five names the first five and counts the rest', () => {
  expect(composeNextLine({
    limit:          3,
    inFlight:       1,
    freeSlots:      2,
    readyTicketIds: ['1', '2', '3', '4', '5', '6', '7'],
  })).toBe('Next: 2 of 3 slots free; ready: #1, #2, #3, #4, #5 and 2 more');
});

/** A limit lowered below the running rows leaves no slot; the line reports what runs, not a negative. */
test('more rows running than the limit allows still reads as no slot free', () => {
  expect(composeNextLine({
    limit:          1,
    inFlight:       3,
    freeSlots:      0,
    readyTicketIds: [],
  })).toBe('Next: no slot free (3 running); nothing ready');
});

test('ids are printed as the store holds them, so a padded id keeps its padding', () => {
  expect(composeNextLine({
    limit:          2,
    inFlight:       1,
    freeSlots:      1,
    readyTicketIds: ['003'],
  })).toBe('Next: 1 of 2 slots free; ready: #003');
});
