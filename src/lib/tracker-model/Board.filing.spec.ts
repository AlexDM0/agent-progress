/**
 * Filing a ticket and changing what it waits on. What callers rely on: a filed ticket joins the board with a pending row filed at the
 * same moment, except a low one, which waits off the chart and spends no task id; a dependency on a ticket the board does not hold, the
 * new ticket's own id among them, or one that closes a circle is refused before anything changes; and a dependency list is set,
 * replaced or cleared as given. Refusals are asserted by reason code, never by wording.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture }                            from '../../testing/BoardFixtures';
import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures';

const FILED_AT   = '2026-09-18T09:30:00+02:00';
const CHANGED_AT = '2026-09-18T11:15:00+02:00';

describe('fileTicket', () => {
  test('a filed ticket joins the board with a pending row filed at the same moment', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    const filed = board.fileTicket(ticketFixture({ id: '002', title: 'Example basket badge' }), FILED_AT);

    expect(tickets.map((ticket) => ticket.frontmatter.id)).toEqual(['001', '002']);
    expect(board.ticketByReference('2')).toBe(filed.ticket);
    expect(progress.tasks).toHaveLength(1);
    expect(progress.tasks[0]).toMatchObject({
      name:    '#002 Example basket badge',
      status:  'pending',
      ticket:  '002',
      history: [{ status: 'pending', at: FILED_AT }],
    });
    expect(filed.ticket.frontmatter.task).toBe(progress.tasks[0]?.id ?? 0);
    expect(records).toEqual([{
      at:       FILED_AT,
      kind:     'ticket-filed',
      ticketId: '002',
      fields:   { title: 'Example basket badge' },
    }]);
    expect(filed.logged).toEqual(records);
  });

  // A low ticket's row is filed when it is started, so filing one must not spend the id that row, or any other, will take.
  test('a low ticket gets no row, and no task id is spent on it', () => {
    const { board, progress } = boardFixture();
    const filed               = board.fileTicket(ticketFixture({ id: '001', priority: 'low' }), FILED_AT);

    expect(filed.ticket.frontmatter.task).toBeNull();
    expect(progress.tasks).toEqual([]);
    expect(progress.nextTaskId).toBe(1);
  });

  test('a dependency on a ticket the board does not hold is refused, the new ticket\'s own id among them, and nothing changes', () => {
    for (const dependsOn of [['007'], ['001', '007'], ['002']]) {
      const {
        board,
        progress,
        tickets,
        records,
      } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
      const missingTicketIds = dependsOn.filter((ticketId) => ticketId !== '001');

      expect(refusalDetailOf(() => board.fileTicket(ticketFixture({ id: '002', dependsOn }), FILED_AT)), dependsOn.join(','))
        .toEqual({ reason: 'unknown-dependency', missingTicketIds });
      expect(tickets).toHaveLength(1);
      expect(progress.tasks).toEqual([]);
      expect(records).toEqual([]);
      expect(board.changedTickets()).toEqual([]);
    }
  });
});

describe('setTicketDependencies', () => {
  function dependencyChainFixture(): BoardFixture {
    return boardFixture({
      tickets: [
        ticketFixture({ id: '001' }),
        ticketFixture({ id: '002', dependsOn: ['001'] }),
        ticketFixture({ id: '003', dependsOn: ['002'] }),
        ticketFixture({ id: '004' }),
      ],
    });
  }

  test('a dependency list is set, replaced and cleared, and each change is logged as given', () => {
    const { board, records } = dependencyChainFixture();

    const set = board.setTicketDependencies('004', ['001'], CHANGED_AT);
    expect(set.ticket.frontmatter.dependsOn).toEqual(['001']);
    expect(set.logged).toEqual([{
      at:       CHANGED_AT,
      kind:     'ticket-dependencies-set',
      ticketId: '004',
      fields:   { dependsOn: ['001'] },
    }]);

    const replaced = board.setTicketDependencies('004', ['002', '003'], CHANGED_AT);
    expect(replaced.ticket.frontmatter.dependsOn).toEqual(['002', '003']);

    // Cleared means no key at all, so the file reads as a ticket that never waited on anything.
    const cleared = board.setTicketDependencies('004', [], CHANGED_AT);
    expect(Object.hasOwn(cleared.ticket.frontmatter, 'dependsOn')).toBe(false);

    expect(records.map((record) => record.fields)).toEqual([{ dependsOn: ['001'] }, { dependsOn: ['002', '003'] }, { dependsOn: [] }]);
  });

  test('a dependency on a ticket the board does not hold is refused, and nothing changes', () => {
    const { board, tickets, records } = dependencyChainFixture();
    const ticketsAsRead               = structuredClone(tickets);

    expect(refusalDetailOf(() => board.setTicketDependencies('003', ['002', '009'], CHANGED_AT)))
      .toEqual({ reason: 'unknown-dependency', missingTicketIds: ['009'] });
    expect(tickets).toEqual(ticketsAsRead);
    expect(records).toEqual([]);
    expect(board.changedTickets()).toEqual([]);
  });

  // A circle would leave every ticket in it waiting on another forever, so no dispatcher could ever start one of them.
  test('a dependency that closes a circle, on the ticket itself or through others, is refused, and nothing changes', () => {
    const cases: readonly (readonly [string, readonly string[], readonly string[]])[] = [
      ['001', ['001'], ['001', '001']],
      ['001', ['003'], ['001', '003', '002', '001']],
    ];
    for (const [ticketId, dependsOn, loopTicketIds] of cases) {
      const { board, tickets, records } = dependencyChainFixture();
      const ticketsAsRead               = structuredClone(tickets);

      expect(refusalDetailOf(() => board.setTicketDependencies(ticketId, dependsOn, CHANGED_AT)), dependsOn.join(','))
        .toEqual({ reason: 'dependency-loop', loopTicketIds });
      expect(tickets).toEqual(ticketsAsRead);
      expect(records).toEqual([]);
      expect(board.changedTickets()).toEqual([]);
    }
  });
});
