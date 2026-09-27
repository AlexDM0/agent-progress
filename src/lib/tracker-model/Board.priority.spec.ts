/**
 * A priority decides whether a ticket has a row: lowering takes a pending ticket's row away and is refused otherwise, and raising seeds a
 * row from the stamps, so an abandoned ticket never returns as a pending bar. Refusals are asserted by reason code.
 */
import { describe, expect, test } from 'bun:test';

import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures.ts';

const FILED_AT     = '2026-09-18T09:00:00+02:00';
const STARTED_AT   = '2026-09-18T10:00:00+02:00';
const FINISHED_AT  = '2026-09-18T12:00:00+02:00';
const CHANGED_AT   = '2026-09-18T15:00:00+02:00';

describe('lowering', () => {
  test('lowering a pending ticket to low removes its row and logs the change', () => {
    const {
      board,
      progress,
      tickets,
      records,
    } = boardFixture({
      tasks:   [taskFixture({ id: 1, name: '#001 Example checkout page', ticket: '001' })],
      tickets: [ticketFixture({ id: '001', task: 1 })],
    });
    const changed = board.setTicketPriority('001', 'low', CHANGED_AT);

    expect(progress.tasks).toEqual([]);
    expect(tickets[0]?.frontmatter).toMatchObject({ priority: 'low', task: null, updated: FILED_AT });
    expect(records).toEqual([{
      at:       CHANGED_AT,
      kind:     'ticket-priority-changed',
      ticketId: '001',
      fields:   { from: 'normal', to: 'low' },
    }]);
    expect(changed.logged).toEqual(records);
    expect(tickets).toEqual([changed.ticket]);
  });

  test('a ticket that is not pending is refused a lowering, and nothing changes', () => {
    const fixture        = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'in-progress', ticket: '001' })],
      tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 })],
    });
    const progressBefore = structuredClone(fixture.progress);
    const ticketsBefore  = structuredClone(fixture.tickets);

    expect(refusalDetailOf(() => fixture.board.setTicketPriority('001', 'low', CHANGED_AT)))
      .toEqual({ reason: 'lowering-a-ticket-that-is-not-pending', ticketId: '001', status: 'in-progress' });
    expect(fixture.progress).toEqual(progressBefore);
    expect(fixture.tickets).toEqual(ticketsBefore);
    expect(fixture.records).toEqual([]);
  });
});

describe('raising', () => {
  test('raising a pending low ticket files a pending row at the moment of the change', () => {
    const { board, progress, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001', priority: 'low' })] });
    board.setTicketPriority('001', 'high', CHANGED_AT);

    expect(progress.tasks).toHaveLength(1);
    expect(progress.tasks[0]).toMatchObject({
      name:    '#001 Example checkout page',
      status:  'pending',
      ticket:  '001',
      history: [{ status: 'pending', at: CHANGED_AT }],
    });
    expect(tickets[0]?.frontmatter).toMatchObject({ priority: 'high', task: progress.tasks[0]?.id ?? 0, updated: FILED_AT });
  });

  test('raising a rowless abandoned ticket seeds an abandoned row spanning its stamps', () => {
    const { board, progress, tickets } = boardFixture({
      tickets: [ticketFixture({
        id:          '001',
        priority:    'low',
        status:      'abandoned',
        started:     STARTED_AT,
        abandonedAt: FINISHED_AT,
        reason:      'superseded by #002',
      })],
    });
    board.setTicketPriority('001', 'normal', CHANGED_AT);

    expect(progress.tasks[0]).toMatchObject({ status: 'abandoned', start: STARTED_AT, end: FINISHED_AT });
    expect(tickets[0]?.frontmatter.task).toBe(progress.tasks[0]?.id ?? 0);
  });

  test('raising a rowless reviewed ticket seeds a reviewed row carrying its review stamp', () => {
    const { board, progress } = boardFixture({
      tickets: [ticketFixture({
        id:       '001',
        priority: 'low',
        status:   'reviewed',
        started:  STARTED_AT,
        finished: FINISHED_AT,
      })],
    });
    board.setTicketPriority('001', 'normal', CHANGED_AT);

    expect(progress.tasks[0]).toMatchObject({
      status:   'reviewed',
      start:    STARTED_AT,
      end:      FINISHED_AT,
      reviewed: FINISHED_AT,
    });
  });

  // A started low ticket already has the row its work is drawn on; a second one would split that work across two bars.
  test('a ticket that has a row keeps it when it is raised', () => {
    const startedRow = taskFixture({
      id:     1,
      status: 'in-progress',
      start:  STARTED_AT,
      ticket: '001',
    });
    const { board, progress, tickets } = boardFixture({
      tasks:   [startedRow],
      tickets: [ticketFixture({
        id:       '001',
        priority: 'low',
        status:   'in-progress',
        started:  STARTED_AT,
        task:     1,
      })],
    });
    board.setTicketPriority('001', 'high', CHANGED_AT);

    expect(progress.tasks).toEqual([startedRow]);
    expect(tickets[0]?.frontmatter.task).toBe(1);
  });
});

test('a priority the ticket already has is refused, a ticket that names none counting as normal, and nothing changes', () => {
  const fixture        = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
  const progressBefore = structuredClone(fixture.progress);
  const ticketsBefore  = structuredClone(fixture.tickets);

  expect(refusalDetailOf(() => fixture.board.setTicketPriority('001', 'normal', CHANGED_AT))).toEqual({
    reason:   'priority-unchanged',
    ticketId: '001',
    status:   'pending',
    priority: 'normal',
  });
  expect(fixture.progress).toEqual(progressBefore);
  expect(fixture.tickets).toEqual(ticketsBefore);
  expect(fixture.records).toEqual([]);
});
