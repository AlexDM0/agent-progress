/**
 * What the ticket subcommands print for a ticket and for what they logged: the JSON document is the ticket document with the body appended
 * last, so a script reading keys in order meets the frontmatter first; the human text is one worded sentence per logged record.
 */
import { describe, expect, test } from 'bun:test';

import { LogUtil }                     from '../../../src/adapters/utils/LogUtil.ts';
import { TicketJsonUtil }              from '../../../src/adapters/utils/TicketJsonUtil.ts';
import { boardFixture, ticketFixture } from '../../../src/testing/BoardFixtures.ts';
import { TicketOutputUtil }            from './TicketOutputUtil.ts';

const { ticketAsJson, loggedSentencesOf } = TicketOutputUtil;

describe('TicketOutputUtil.ticketAsJson', () => {
  test('is the ticket document with the body appended as the last key', () => {
    const ticket   = { ...ticketFixture({ id: '003', priority: 'high' }), body: '## Example\n\nThe body.\n' };
    const document = ticketAsJson(ticket);

    expect(document).toEqual({ ...TicketJsonUtil.ticketDocumentOf(ticket), body: '## Example\n\nThe body.\n' });
    expect(Object.keys(document).at(-1)).toBe('body');
    expect(Object.keys(document).at(-2)).toBe('filePath');
  });
});

describe('TicketOutputUtil.loggedSentencesOf', () => {
  test('words each logged record and joins them one per line', () => {
    const { board, records } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });
    board.setTicketPriority('001', 'high', '2026-09-18T09:30:00+02:00');
    board.setTicketPriority('002', 'low', '2026-09-18T09:31:00+02:00');

    expect(records).toHaveLength(2);
    expect(loggedSentencesOf(records)).toBe('Ticket #001 priority normal → high\nTicket #002 priority normal → low');
    expect(loggedSentencesOf(records)).toBe(records.map(LogUtil.sentenceOf).join('\n'));
  });

  test('nothing logged is the empty text', () => {
    expect(loggedSentencesOf([])).toBe('');
  });
});
