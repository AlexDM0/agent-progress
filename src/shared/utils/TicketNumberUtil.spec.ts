/**
 * The hook and the page nest a review row under its ticket by comparing numbers, so every spelling of one ticket must compare equal, a stored
 * `reviewOf` must beat the name, and a bundle's review names its first ticket. Text that names no number gives `null`, never a match.
 */
import { describe, expect, test } from 'bun:test';

import type { Task }        from '../../lib/tracker-model/@types/Task.ts';
import { TicketNumberUtil } from './TicketNumberUtil.ts';

const { ticketNumberOf, reviewedTicketNumberOf, reviewRoundNamedBy } = TicketNumberUtil;

function exampleTask(name: string, reviewOf?: string): Task {
  return {
    id:     7,
    name,
    status: 'in-progress',
    start:  '2026-01-01T09:00:00Z',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...(reviewOf === undefined ? {} : { reviewOf }),
  };
}

describe('ticketNumberOf', () => {
  test('a padded and an unpadded id name the same ticket', () => {
    expect(ticketNumberOf('003')).toBe(3);
    expect(ticketNumberOf('3')).toBe(3);
  });

  test('an empty, absent or non-numeric identifier gives null', () => {
    expect(ticketNumberOf('')).toBeNull();
    expect(ticketNumberOf(undefined)).toBeNull();
    expect(ticketNumberOf('example')).toBeNull();
  });
});

describe('reviewedTicketNumberOf', () => {
  // The name's `#3`, a stored `003` and a ticket row's `3` must all land on one number, or a review row is drawn apart from its ticket.
  test('a name\'s #3, a stored 003 and a plain 3 compare equal', () => {
    expect(reviewedTicketNumberOf(exampleTask('Example review pass', '003'))).toBe(3);
    expect(reviewedTicketNumberOf(exampleTask('Review 1 #3 — Example ticket'))).toBe(3);
    expect(ticketNumberOf('3')).toBe(3);
  });

  test('a stored reviewOf wins over the number the name gives', () => {
    expect(reviewedTicketNumberOf(exampleTask('Review 1 #5 — Example ticket', '008'))).toBe(8);
  });

  test('a bundle\'s review names its first ticket as the parent', () => {
    expect(reviewedTicketNumberOf(exampleTask('Review 1 #13, #5 — Example bundle'))).toBe(13);
  });

  test('a row that is not a review, or whose reviewOf is empty or not a number, gives null', () => {
    expect(reviewedTicketNumberOf(exampleTask('Example feature work'))).toBeNull();
    expect(reviewedTicketNumberOf(exampleTask('Review 1 #3 — Example ticket', ''))).toBeNull();
    expect(reviewedTicketNumberOf(exampleTask('Example review pass', 'example'))).toBeNull();
  });
});

describe('reviewRoundNamedBy', () => {
  test('reads the round from a review row\'s name', () => {
    expect(reviewRoundNamedBy(exampleTask('Review 2 #3 — Example ticket'))).toBe(2);
  });

  // The largest round sorts first, so a row whose name gives no round is drawn above every numbered pass.
  test('a name that is not a review gives Number.MAX_SAFE_INTEGER', () => {
    expect(reviewRoundNamedBy(exampleTask('Example review pass', '003'))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
