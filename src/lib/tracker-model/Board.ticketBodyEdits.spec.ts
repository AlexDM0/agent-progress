/**
 * A body edit changes the body alone: no stamp, no log record, and the ticket is marked for writing only when its body changed. The text
 * takes the body's own line ending, and a body holding none takes the frontmatter's, so a one-line CRLF body does not gain an LF.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, ticketFixture } from '../../testing/BoardFixtures.ts';

describe('editTicketBody', () => {
  test('a replacement changes the body only, stamps nothing, logs nothing and marks the ticket', () => {
    const ticket = ticketFixture();
    const { board, records } = boardFixture({ tickets: [ticket] });
    const frontmatterBefore  = structuredClone(ticket.frontmatter);

    const edited = board.editTicketBody('001', { text: 'Replaced.\n', appends: false });

    expect(edited.changed).toBe(true);
    expect(ticket.body).toBe('Replaced.\n');
    expect(ticket.frontmatter).toEqual(frontmatterBefore);
    expect(records).toEqual([]);
    expect(board.changedTickets()).toEqual([ticket]);
  });

  test('an append to a one-line body of a CRLF ticket separates and converts with CRLF', () => {
    const ticket = { ...ticketFixture(), body: 'One line', lineEnding: '\r\n' as const };
    const { board } = boardFixture({ tickets: [ticket] });

    board.editTicketBody('001', { text: 'Second\nThird\n', appends: true });

    expect(ticket.body).toBe('One line\r\nSecond\r\nThird\r\n');
  });

  test('an edit that leaves the body as it reads marks nothing for writing', () => {
    const ticket = { ...ticketFixture(), body: 'Same.\n' };
    const { board } = boardFixture({ tickets: [ticket] });

    expect(board.editTicketBody('001', { text: '', appends: true }).changed).toBe(false);
    expect(board.editTicketBody('001', { text: 'Same.\n', appends: false }).changed).toBe(false);
    expect(board.changedTickets()).toEqual([]);
  });
});
