/**
 * A body edit changes the body alone: no stamp, no log record, and the ticket is marked for writing only when its body changed. The text
 * takes the body's own line ending, and a body holding none takes the frontmatter's, so a one-line CRLF body does not gain an LF. A new
 * title renames the ticket's own row and a heading reading exactly as `ticket add` generates it, logs one record, stamps nothing, and
 * never renames a review bar or a heading someone changed by hand. Past `pending` an edit is refused unless allowed, since a builder may
 * already work from the body; a claim records the body's hash, so an allowed body edit reads as changed while a rename alone does not.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import { BoardRefusal }                             from './BoardRefusal.ts';
import { TicketBodyHashUtil }                       from './utils/TicketBodyHashUtil.ts';

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

describe('editTicket past pending, and the claimed body hash', () => {
  function claimedFixture(): ReturnType<typeof boardFixture> & { ticket: ReturnType<typeof ticketFixture> } {
    const ticket  = { ...ticketFixture(), body: '# 001 — Example checkout page\n\n## Report\n' };
    const fixture = boardFixture({ tickets: [ticket] });
    fixture.board.claimTickets(['001'], {}, EDITED_AT);
    fixture.records.length = 0;
    return { ...fixture, ticket };
  }

  test('a pending ticket carries no hash, and a claim and a start each record the body\'s', () => {
    const pending = ticketFixture();
    expect(pending.frontmatter.claimedBodyHash).toBeUndefined();

    const { ticket } = claimedFixture();
    expect(ticket.frontmatter.claimedBodyHash).toBe(TicketBodyHashUtil.bodyHashOf(ticket.body));
    expect(TicketBodyHashUtil.bodyChangedSinceClaimOf(ticket)).toBe(false);

    const started = { ...ticketFixture(), body: 'Started from this.\n' };
    boardFixture({ tickets: [started] }).board.moveTicket('001', 'in-progress', { checksLegality: true }, EDITED_AT);
    expect(started.frontmatter.claimedBodyHash).toBe(TicketBodyHashUtil.bodyHashOf('Started from this.\n'));
  });

  test('every status past pending refuses an edit that does not allow it, changing and marking nothing', () => {
    for (const status of ['in-progress', 'in-review', 'reviewed', 'delivered', 'abandoned'] as const) {
      const ticket = { ...ticketFixture({ status }), body: 'Kept.\n' };
      const { board, records } = boardFixture({ tickets: [ticket] });

      expect(() => board.editTicket('001', { body: { text: 'Replaced.\n', appends: false } }, EDITED_AT)).toThrow(
        expect.objectContaining({ detail: { reason: 'edit-of-a-ticket-past-pending', ticketId: '001', status } }),
      );
      expect(() => board.editTicket('001', { title: 'Example payment page' }, EDITED_AT)).toThrow(BoardRefusal);
      expect(ticket.body).toBe('Kept.\n');
      expect(records).toEqual([]);
      expect(board.changedTickets()).toEqual([]);
    }
  });

  test('a held pending ticket is edited', () => {
    const ticket = ticketFixture({ hold: 'waiting on Example Agency' });
    const { board } = boardFixture({ tickets: [ticket] });

    expect(board.editTicket('001', { body: { text: 'Replaced.\n', appends: false } }, EDITED_AT).changed).toBe(true);
  });

  test('an allowed body edit after the claim logs once and reads as changed since the claim', () => {
    const { board, records, ticket } = claimedFixture();

    board.editTicket('001', { body: { text: 'Rewritten.\n', appends: true }, allowsPastPending: true }, EDITED_AT);

    expect(records).toEqual([{
      at: EDITED_AT, kind: 'ticket-body-changed-after-claim', ticketId: '001', fields: {}
    }]);
    expect(TicketBodyHashUtil.bodyChangedSinceClaimOf(ticket)).toBe(true);
  });

  test('a rename after the claim retitles the heading but does not read as a body change', () => {
    const { board, records, ticket } = claimedFixture();

    board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page\n\n## Report\n');
    expect(records.map((record) => record.kind)).toEqual(['ticket-retitled']);
    expect(TicketBodyHashUtil.bodyChangedSinceClaimOf(ticket)).toBe(false);
  });

  test('a rename after a body change keeps it reading as changed', () => {
    const { board, ticket } = claimedFixture();
    board.editTicket('001', { body: { text: 'Rewritten.\n', appends: true }, allowsPastPending: true }, EDITED_AT);

    board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);

    expect(TicketBodyHashUtil.bodyChangedSinceClaimOf(ticket)).toBe(true);
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

    const edited = board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);

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

    board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page\r\n\r\n# 001 — Example checkout page\r\n');
  });

  test('a hand-changed heading, or a heading-only body without a line ending that reads otherwise, is kept byte for byte', () => {
    for (const body of ['# 001 — Example checkout page, revised\n', '# Example checkout page\n', '#  001 — Example checkout page']) {
      const { board, ticket } = retitlingFixture(body);
      board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);
      expect(ticket.body).toBe(body);
    }
  });

  test('a body that is only the generated heading without a line ending is retitled', () => {
    const { board, ticket } = retitlingFixture('# 001 — Example checkout page');

    board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page');
  });

  test('a title and an append apply together, the append landing on the retitled body', () => {
    const { board, records, ticket } = retitlingFixture('# 001 — Example checkout page\n');

    board.editTicket('001', { title: 'Example payment page', body: { text: 'Appended.\n', appends: true }, allowsPastPending: true }, EDITED_AT);

    expect(ticket.body).toBe('# 001 — Example payment page\nAppended.\n');
    expect(records.map((record) => record.kind)).toEqual(['ticket-retitled', 'ticket-body-changed-after-claim']);
  });

  test('the title the ticket already has changes nothing, logs nothing and marks nothing', () => {
    const {
      board, records, progress, ticket
    } = retitlingFixture('# 001 — Example checkout page\n');

    const edited = board.editTicket('001', { title: 'Example checkout page', allowsPastPending: true }, EDITED_AT);

    expect(edited.changed).toBe(false);
    expect(ticket.body).toBe('# 001 — Example checkout page\n');
    expect(progress.tasks[0]?.name).toBe('#001 Example checkout page');
    expect(records).toEqual([]);
    expect(board.changedTickets()).toEqual([]);
  });

  test('a low ticket without a row is retitled without one', () => {
    const ticket = ticketFixture({ priority: 'low' });
    const { board, progress } = boardFixture({ tickets: [ticket] });

    board.editTicket('001', { title: 'Example payment page', allowsPastPending: true }, EDITED_AT);

    expect(ticket.frontmatter.title).toBe('Example payment page');
    expect(progress.tasks).toEqual([]);
  });
});
