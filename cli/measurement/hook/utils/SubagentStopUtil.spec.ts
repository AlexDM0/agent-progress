/**
 * The brief's marker decides which rows and tickets a finished agent's cost lands on. What callers rely on: a marker counts only in the
 * brief and only on a line of its own, each id form reads as the stored id, and the shares of a bundle always sum to its total.
 */
import { describe, expect, test } from 'bun:test';

import { SubagentStopUtil } from './SubagentStopUtil';

const {
  evenSharesOf,
  reviewedTicketIdentifierNamedInBrief,
  rowIdentifiersNamedInBrief,
  ticketIdentifiersNamedInBrief,
} = SubagentStopUtil;

/**
 * The marker decides which row an agent's cost lands on, so what matters is what must NOT count: a marker
 * quoted after the brief, a template placeholder, and an attachment turn standing in front of the brief.
 */
describe('the rows a brief names', () => {
  function userTextLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
  }

  test('one id, or several separated by commas, are read in the order written', () => {
    expect(rowIdentifiersNamedInBrief(userTextLine('Do it.\nagent-progress row: 4\nStop.'))).toEqual([4]);
    expect(rowIdentifiersNamedInBrief(userTextLine('agent-progress row: 4, 7'))).toEqual([4, 7]);
    expect(rowIdentifiersNamedInBrief(userTextLine('  agent-progress row: 7,4,4  '))).toEqual([7, 4]);
  });

  /** A reviewer may be shown the builder's brief; the marker it quotes is the builder's row, not its own. */
  test('a marker in a later user turn is not the brief\'s, so it names nothing', () => {
    const transcript = [userTextLine('Review the branch.'), userTextLine('agent-progress row: 4')].join('\n');

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([]);
  });

  test('an attachment-only opening turn is passed over, as for the excerpt, and the brief after it is read', () => {
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: 'agent-progress row: 9' } }] } }),
      userTextLine('agent-progress row: 4'),
    ].join('\n');

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
  });

  test('a placeholder, a marker inside a sentence and a brief without one all name nothing', () => {
    expect(rowIdentifiersNamedInBrief(userTextLine('agent-progress row: <rowId>'))).toEqual([]);
    expect(rowIdentifiersNamedInBrief(userTextLine('Write agent-progress row: 4 into the brief.'))).toEqual([]);
    expect(rowIdentifiersNamedInBrief(userTextLine('Do the work.'))).toEqual([]);
    expect(rowIdentifiersNamedInBrief('')).toEqual([]);
  });

  test('a brief split over several text blocks is read line by line, so a marker in the second block counts', () => {
    const transcript = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Do it.' }, { type: 'text', text: 'agent-progress row: 4' }] } });

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
  });
});

/**
 * The ticket form exists for a low ticket whose row the builder's own claim creates, so the ids are only
 * read here and resolved later. What callers rely on: padded, unpadded and `#` spellings all come back as
 * the stored padded id, and the brief-only rule is the row form's.
 */
describe('the tickets a brief names', () => {
  function userTextLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
  }

  test('padded, unpadded and hash-prefixed ids all read as the padded id, in the order written and each once', () => {
    expect(ticketIdentifiersNamedInBrief(userTextLine('Do it.\nagent-progress ticket: 22\nStop.'))).toEqual(['022']);
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress ticket: 022, 20'))).toEqual(['022', '020']);
    expect(ticketIdentifiersNamedInBrief(userTextLine('  agent-progress ticket: #20,22,022  '))).toEqual(['020', '022']);
  });

  test('a marker in a later user turn is not the brief\'s, so it names nothing', () => {
    const transcript = [userTextLine('Review the branch.'), userTextLine('agent-progress ticket: 22')].join('\n');

    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual([]);
  });

  test('a placeholder, a marker inside a sentence, ticket zero and the row form all name no ticket', () => {
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress ticket: <id>'))).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(userTextLine('Write agent-progress ticket: 22 into the brief.'))).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress ticket: 0'))).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress row: 22'))).toEqual([]);
  });

  test('a brief carrying both lines answers each reader with its own', () => {
    const transcript = userTextLine('agent-progress row: 4\nagent-progress ticket: 22');

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual(['022']);
  });
});

/**
 * The review form names one ticket whose review row the reviewer files itself after its brief was written; the hook resolves the row.
 * What callers rely on: the padded id in every spelling, the brief-only rule, and a list or a placeholder naming nothing rather than a guess.
 */
describe('the ticket a reviewer\'s brief names', () => {
  function userTextLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
  }

  test('padded, unpadded and hash-prefixed ids all read as the padded id', () => {
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('Review it.\nagent-progress review: 7\nStop.'))).toBe('007');
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('  agent-progress review: #007  '))).toBe('007');
  });

  test('a marker in a later user turn is not the brief\'s, so it names nothing', () => {
    const transcript = [userTextLine('Review the branch.'), userTextLine('agent-progress review: 7')].join('\n');

    expect(reviewedTicketIdentifierNamedInBrief(transcript)).toBeNull();
  });

  test('a placeholder, a list, ticket zero and the other two forms all name no ticket', () => {
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress review: <ticketId>'))).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress review: 7, 8'))).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress review: 0'))).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress ticket: 7\nagent-progress row: 7'))).toBeNull();
  });
});

/**
 * A workflow agent's transcript opens with the harness relaying the session user's request and only then the script's prompt, both as plain
 * strings rather than content arrays. What callers rely on: the computed task is read as the brief, and nothing else after a relay ever is.
 */
describe('a workflow agent\'s brief', () => {
  const RELAY_TURN = '[Workflow harness — user request] The harness relays the request below.\n  Run the board.';

  function plainUserLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  function computedTaskTurn(indentedTask: string): string {
    return `[Workflow harness — computed task] The task text below was computed at runtime.\n${indentedTask}`;
  }

  test('the computed task right after the relay is the brief, its indented marker lines read in all three forms', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine(computedTaskTurn('  agent-progress ticket: 7\n  agent-progress row: 4\n  agent-progress review: 9'))].join('\n');

    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual(['007']);
    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
    expect(reviewedTicketIdentifierNamedInBrief(transcript)).toBe('009');
  });

  test('a computed task without a marker names nothing', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine(computedTaskTurn('  Build the ticket.'))].join('\n');

    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual([]);
  });

  /** Only the computed task may stand in for the brief; an ordinary later message quoting a marker is what the brief-only rule exists to ignore. */
  test('a relay followed by an ordinary message carrying a marker names nothing', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine('agent-progress ticket: 7')].join('\n');

    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual([]);
  });

  test('a computed task after an ordinary message is not the brief, and neither is a marker the relay itself quotes', () => {
    const lateComputedTask = [plainUserLine(RELAY_TURN), plainUserLine('Hello.'), plainUserLine(computedTaskTurn('  agent-progress ticket: 7'))].join('\n');
    const relayAlone       = plainUserLine(`${RELAY_TURN}\n  agent-progress ticket: 7`);

    expect(ticketIdentifiersNamedInBrief(lateComputedTask)).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(relayAlone)).toEqual([]);
  });

  test('a first turn that is not a relay is the brief as before, even when a computed task follows it', () => {
    const transcript = [plainUserLine('agent-progress ticket: 3'), plainUserLine(computedTaskTurn('  agent-progress ticket: 7'))].join('\n');

    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual(['003']);
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
