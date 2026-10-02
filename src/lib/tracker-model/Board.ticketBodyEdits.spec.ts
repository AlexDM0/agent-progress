/**
 * A body edit changes the body alone: no stamp, no log record, and the ticket is marked for writing only when its body changed. The text
 * takes the body's own line ending, and a body holding none takes the frontmatter's, so a one-line CRLF body does not gain an LF. A new
 * title renames the ticket's own row and a heading reading exactly as `ticket add` generates it, logs one record, stamps nothing, and
 * never renames a review bar or a heading someone changed by hand.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';

const EDITED_AT = '2026-09-26T10:15:00+02:00';

describe('editTicket, the body', () => {
  test('a replacement changes the body only, stamps nothing, logs nothing and marks the ticket', () => {
    const ticket = ticketFixture();
    const { board, records } = boardFixture({ tickets: [ticket] });
    const frontmatterBefore  = structuredClone(ticket.frontmatter);

    const edited = board.editTicket('001', { body: { text: 'Replaced.\n', appends: false } }, EDITED_AT);

    expect(edited.changed).toBe(true);
    expect(ticket.body).toBe('Replaced.\n');
    expect(ticket.frontmatter).toEqual(frontmatterBefore);
    expect(records).toEqual([]);
    expect(board.changedTickets()).toEqual([ticket]);
  });

  test('an append to a one-line body of a CRLF ticket separates and converts with CRLF', () => {
    const ticket = { ...ticketFixture(), body: 'One line', lineEnding: '\r\n' as const };
    const { board } = boardFixture({ tickets: [ticket] });

    board.editTicket('001', { body: { text: 'Second\nThird\n', appends: true } }, EDITED_AT);

    expect(ticket.body).toBe('One line\r\nSecond\r\nThird\r\n');
  });

  test('an edit that leaves the body as it reads marks nothing for writing', () => {
    const ticket = { ...ticketFixture(), body: 'Same.\n' };
    const { board } = boardFixture({ tickets: [ticket] });

    expect(board.editTicket('001', { body: { text: '', appends: true } }, EDITED_AT).changed).toBe(false);
    expect(board.editTicket('001', { body: { text: 'Same.\n', appends: false } }, EDITED_AT).changed).toBe(false);
    expect(board.changedTickets()).toEqual([]);
  });
});

describe('editTicket, the title', () => {
  function retitlingFixture(body: string): ReturnType<typeof boardFixture> & { ticket: ReturnType<typeof ticketFixture> } {
    const ticket = { ...ticketFixture({ task: 1, status: 'in-review' }), body };
    const fixture = boardFixture({
      tickets: [ticket],
      tasks:   [
        taskFixture({
          id: 1, name: '#001 Example checkout page', ticket: '001', status: 'in-review'
        }),
        taskFixture({
          id: 2, name: 'Review 1 #001 — Example checkout page', ticket: '001', status: 'in-progress'
        }),
      ],
    });
    return { ...fixture, ticket };
  }

  test('a new title renames the own row but no review bar, stamps nothing and logs one record naming both titles', () => {
    const {
      board, records, progress, ticket
    } = retitlingFixture('## Report\n');
    const updatedBefore = ticket.frontmatter.updated;

    const edited = board.editTicket('001', { title: 'Example payment page' }, EDITED_AT);

    expect(edited.changed).toBe(true);
    expect(ticket.frontmatter.title).toBe('Example payment page');
    expect(ticket.frontmatter.updated).toBe(updatedBefore);
    expect(progress.tasks.map((task) => task.name)).toEqual(['#001 Example payment page', 'Review 1 #001 — Example checkout page']);
    expect(records).toEqual([{
      at: EDITED_AT, kind: 'ticket-retitled', ticketId: '001', fields: { from: 'Example checkout page', to: 'Example payment page' }
    }]);
    expect(edited.logged).toEqual(records);
    expect(board.changedTickets()).toEqual([ticket]);
  });

  test('the generated heading follows the title, keeping its CRLF, and nothing else in the body changes', () => {
    const { board, ticket } = retitlingFixture('# 001 — Example checkout page\r\n\r\n# 001 — Example checkout page\r\n');

    board.editTicket('001', { title: 'Example payment page' }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page\r\n\r\n# 001 — Example checkout page\r\n');
  });

  test('a hand-changed heading, or a heading-only body without a line ending that reads otherwise, is kept byte for byte', () => {
    for (const body of ['# 001 — Example checkout page, revised\n', '# Example checkout page\n', '#  001 — Example checkout page']) {
      const { board, ticket } = retitlingFixture(body);
      board.editTicket('001', { title: 'Example payment page' }, EDITED_AT);
      expect(ticket.body).toBe(body);
    }
  });

  test('a body that is only the generated heading without a line ending is retitled', () => {
    const { board, ticket } = retitlingFixture('# 001 — Example checkout page');

    board.editTicket('001', { title: 'Example payment page' }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page');
  });

  test('a title and an append apply together, the append landing on the retitled body', () => {
    const { board, records, ticket } = retitlingFixture('# 001 — Example checkout page\n');

    board.editTicket('001', { title: 'Example payment page', body: { text: 'Appended.\n', appends: true } }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page\nAppended.\n');
    expect(records).toHaveLength(1);
  });

  test('the title the ticket already has changes nothing, logs nothing and marks nothing', () => {
    const {
      board, records, progress, ticket
    } = retitlingFixture('# 001 — Example checkout page\n');

    const edited = board.editTicket('001', { title: 'Example checkout page' }, EDITED_AT);

    expect(edited.changed).toBe(false);
    expect(ticket.body).toBe('# 001 — Example checkout page\n');
    expect(progress.tasks[0]?.name).toBe('#001 Example checkout page');
    expect(records).toEqual([]);
    expect(board.changedTickets()).toEqual([]);
  });

  test('a low ticket without a row is retitled without one', () => {
    const ticket = ticketFixture({ priority: 'low' });
    const { board, progress } = boardFixture({ tickets: [ticket] });

    board.editTicket('001', { title: 'Example payment page' }, EDITED_AT);

    expect(ticket.frontmatter.title).toBe('Example payment page');
    expect(progress.tasks).toEqual([]);
  });
});
