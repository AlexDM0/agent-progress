/**
 * What the pipeline relies on when it words a refusal: the detail survives being thrown, the message is the bare reason code (no
 * wording), and the predicate accepts only a BoardRefusal, not an Error that merely carries a `detail`.
 */
import { expect, test } from 'bun:test';

import { BoardRefusal, refusalIsBoardRefusal, type BoardRefusalDetail } from './BoardRefusal.ts';

const EXAMPLE_DETAIL: BoardRefusalDetail = {
  reason:       'ticket-owned-row',
  taskId:       4,
  ticketId:     '003',
  targetStatus: 'delivered',
};

class LookalikeError extends Error {
  readonly detail = EXAMPLE_DETAIL;
}

test('the detail survives being thrown and caught, facts and all', () => {
  let caught: unknown = null;
  try {
    throw new BoardRefusal(EXAMPLE_DETAIL);
  } catch (error) {
    caught = error;
  }
  expect(refusalIsBoardRefusal(caught)).toBe(true);
  expect(refusalIsBoardRefusal(caught) ? caught.detail : null).toEqual(EXAMPLE_DETAIL);
});

// The wording lives at the command surface, so the message a stack trace shows is the reason code and nothing a reader is told.
test('the message is the reason code, and it is an Error with its own name', () => {
  const refusal = new BoardRefusal({ reason: 'ticket-not-held', ticketId: '003' });
  expect(refusal.message).toBe('ticket-not-held');
  expect(refusal).toBeInstanceOf(Error);
  expect(refusal.name).toBe('BoardRefusal');
});

test('the predicate refuses a plain Error, and an Error that carries a detail without being one', () => {
  expect(refusalIsBoardRefusal(new Error('ticket-owned-row'))).toBe(false);
  expect(refusalIsBoardRefusal(new LookalikeError('ticket-owned-row'))).toBe(false);
  expect(refusalIsBoardRefusal({ name: 'BoardRefusal', message: 'ticket-owned-row', detail: EXAMPLE_DETAIL })).toBe(false);
});
