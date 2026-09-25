/**
 * What `cli/Main.ts` relies on when it turns a caught value into an exit code: the status survives
 * being thrown, and the predicate rejects anything that merely looks like a refusal.
 */
import { expect, test } from 'bun:test';

import { OperationRefusal, refusalIsOperationRefusal } from './OperationRefusal';

test('the status survives being thrown and caught, which is the only path it ever travels', () => {
  let caught: unknown = null;
  try {
    throw new OperationRefusal('unrepaired', 'The lock at /example/.agent-progress/.lock is held.');
  } catch (error) {
    caught = error;
  }
  expect(refusalIsOperationRefusal(caught)).toBe(true);
  expect(refusalIsOperationRefusal(caught) ? caught.status : null).toBe('unrepaired');
});

test('both statuses are carried verbatim, so the two exit codes stay distinguishable', () => {
  expect(new OperationRefusal('refused', 'no tracker here').status).toBe('refused');
  expect(new OperationRefusal('unrepaired', 'lock held').status).toBe('unrepaired');
});

test('the message is left exactly as written, because it is what the reader is told to do next', () => {
  const refusal = new OperationRefusal('refused', 'No tracker here. Run `agent-progress init` in /example/repository.');
  expect(refusal.message).toBe('No tracker here. Run `agent-progress init` in /example/repository.');
});

test('it is an Error with a stack and its own name', () => {
  const refusal = new OperationRefusal('refused', 'no tracker here');
  expect(refusal).toBeInstanceOf(Error);
  expect(refusal.name).toBe('OperationRefusal');
  expect(typeof refusal.stack).toBe('string');
});

test('the predicate refuses anything that is not one of ours, however much it looks like one', () => {
  const lookalikes: unknown[] = [
    null,
    undefined,
    'refused',
    { status: 'refused', message: 'looks right' },
    new Error('an ordinary error'),
    new TypeError('undefined is not a function'),
  ];
  expect(lookalikes.filter((value) => refusalIsOperationRefusal(value))).toEqual([]);
});

test('the predicate narrows the type, so a caller can read the status without a cast', () => {
  const caught: unknown = new OperationRefusal('refused', 'no tracker here');
  expect(refusalIsOperationRefusal(caught) ? caught.status : 'not-a-refusal').toBe('refused');
});
