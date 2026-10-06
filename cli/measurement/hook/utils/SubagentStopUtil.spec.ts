/**
 * The brief's marker decides which rows and tickets a finished agent's cost lands on. Every case here is brief text, never a transcript:
 * finding the brief is the host's job. What callers rely on: a marker counts only on a line of its own, each id form reads as the stored
 * id, one marker kind wins by precedence, and the shares of a bundle always sum to its total.
 */
import { describe, expect, test } from 'bun:test';

import { SubagentStopUtil } from './SubagentStopUtil.ts';

const {
  creditsFor,
  evenSharesOf,
  reviewedTicketIdentifierNamedInBrief,
  rowIdentifiersNamedInBrief,
  ticketIdentifiersNamedInBrief,
} = SubagentStopUtil;

describe('the rows a brief names', () => {
  test('one id, or several separated by commas, are read in the order written and each once', () => {
    expect(rowIdentifiersNamedInBrief('Do it.\nagent-progress row: 4\nStop.')).toEqual([4]);
    expect(rowIdentifiersNamedInBrief('agent-progress row: 4, 7')).toEqual([4, 7]);
    expect(rowIdentifiersNamedInBrief('  agent-progress row: 7,4,4  ')).toEqual([7, 4]);
  });

  test('a placeholder, a marker inside a sentence and a brief without one all name nothing', () => {
    expect(rowIdentifiersNamedInBrief('agent-progress row: <rowId>')).toEqual([]);
    expect(rowIdentifiersNamedInBrief('Write agent-progress row: 4 into the brief.')).toEqual([]);
    expect(rowIdentifiersNamedInBrief('Do the work.')).toEqual([]);
    expect(rowIdentifiersNamedInBrief('')).toEqual([]);
  });
});

/** The ticket form exists for a low ticket whose row the builder's own claim creates, so the ids are only read here and resolved later. */
describe('the tickets a brief names', () => {
  test('padded, unpadded and hash-prefixed ids all read as the padded id, in the order written and each once', () => {
    expect(ticketIdentifiersNamedInBrief('Do it.\nagent-progress ticket: 22\nStop.')).toEqual(['022']);
    expect(ticketIdentifiersNamedInBrief('agent-progress ticket: 022, 20')).toEqual(['022', '020']);
    expect(ticketIdentifiersNamedInBrief('  agent-progress ticket: #20,22,022  ')).toEqual(['020', '022']);
  });

  test('a placeholder, a marker inside a sentence, ticket zero and the row form all name no ticket', () => {
    expect(ticketIdentifiersNamedInBrief('agent-progress ticket: <id>')).toEqual([]);
    expect(ticketIdentifiersNamedInBrief('Write agent-progress ticket: 22 into the brief.')).toEqual([]);
    expect(ticketIdentifiersNamedInBrief('agent-progress ticket: 0')).toEqual([]);
    expect(ticketIdentifiersNamedInBrief('agent-progress row: 22')).toEqual([]);
  });
});

/** The review form names one ticket whose review row the reviewer files itself after its brief was written; the hook resolves the row. */
describe('the ticket a reviewer\'s brief names', () => {
  test('padded, unpadded and hash-prefixed ids all read as the padded id', () => {
    expect(reviewedTicketIdentifierNamedInBrief('Review it.\nagent-progress review: 7\nStop.')).toBe('007');
    expect(reviewedTicketIdentifierNamedInBrief('  agent-progress review: #007  ')).toBe('007');
  });

  test('a placeholder, a list, ticket zero and the other two forms all name no ticket', () => {
    expect(reviewedTicketIdentifierNamedInBrief('agent-progress review: <ticketId>')).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief('agent-progress review: 7, 8')).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief('agent-progress review: 0')).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief('agent-progress ticket: 7\nagent-progress row: 7')).toBeNull();
  });
});

/** A workflow agent's brief is the computed task, its lines indented by the harness; the markers in it must read all the same. */
describe('the credits a brief earns', () => {
  test('each marker kind alone credits its own target with the whole total', () => {
    expect(creditsFor('agent-progress row: 4', 900)).toEqual([{ target: 'row', taskId: 4, tokens: 900 }]);
    expect(creditsFor('agent-progress ticket: 22', 900)).toEqual([{ target: 'ticket', ticketId: '022', tokens: 900 }]);
    expect(creditsFor('agent-progress review: 7', 900)).toEqual([{ target: 'review', ticketId: '007', tokens: 900 }]);
  });

  test('row wins over ticket, and ticket over review, so a brief carrying several credits once', () => {
    const allThree = '  agent-progress review: 9\n  agent-progress ticket: 7\n  agent-progress row: 4';

    expect(creditsFor(allThree, 900)).toEqual([{ target: 'row', taskId: 4, tokens: 900 }]);
    expect(creditsFor('agent-progress review: 9\nagent-progress ticket: 7', 900)).toEqual([{ target: 'ticket', ticketId: '007', tokens: 900 }]);
  });

  test('a bundle splits the total evenly over its rows, the remainder on the first', () => {
    expect(creditsFor('agent-progress row: 4, 7', 1001)).toEqual([
      { target: 'row', taskId: 4, tokens: 501 },
      { target: 'row', taskId: 7, tokens: 500 },
    ]);
    expect(creditsFor('agent-progress ticket: 22, 20', 10)).toEqual([
      { target: 'ticket', ticketId: '022', tokens: 5 },
      { target: 'ticket', ticketId: '020', tokens: 5 },
    ]);
  });

  test('a brief with no marker earns no credit', () => {
    expect(creditsFor('Build the ticket.', 900)).toEqual([]);
    expect(creditsFor('', 900)).toEqual([]);
  });
});

describe('dividing a bundle\'s tokens', () => {
  test('the shares are floored and the remainder goes to the first, so they always sum to the total', () => {
    expect(evenSharesOf(1001, 2)).toEqual([501, 500]);
    expect(evenSharesOf(10, 3)).toEqual([4, 3, 3]);
    expect(evenSharesOf(1001, 1)).toEqual([1001]);
  });

  test('no rows means no shares', () => {
    expect(evenSharesOf(1001, 0)).toEqual([]);
  });
});
