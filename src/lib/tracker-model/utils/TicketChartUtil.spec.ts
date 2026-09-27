/**
 * Where a ticket stands on the chart. What callers rely on: only a low ticket never started, pending or abandoned, has no row to be given;
 * the two stored row names; and the row a ticket is seeded as after `clear`, drawn from its own stamps.
 */
import { describe, expect, test } from 'bun:test';

import type { Task }              from '../@types/Task.ts';
import type { TicketFrontmatter } from '../@types/Ticket.ts';
import { TICKET_STATUSES }        from '../constants/Statuses.ts';
import { TaskFilingUtil }         from './TaskFilingUtil.ts';
import { TicketChartUtil }        from './TicketChartUtil.ts';

const {
  reviewBarNameOf,
  rowNameOf,
  seededFilingOf,
  ticketStaysOffTheChart,
} = TicketChartUtil;

const FILED_AT     = '2026-09-18T09:00:00+02:00';
const STARTED_AT   = '2026-09-18T10:00:00+02:00';
const FINISHED_AT  = '2026-09-18T12:00:00+02:00';
const DELIVERED_AT = '2026-09-18T15:00:00+02:00';
const TICKET_NAME  = '#003 Fix the export dialog';

const SEEDED_ROW_ID = 1;

function frontmatterFixture(overrides: Partial<TicketFrontmatter> = {}): TicketFrontmatter {
  return {
    id:          '003',
    title:       'Fix the export dialog',
    type:        'bug',
    status:      'pending',
    filed:       FILED_AT,
    updated:     FILED_AT,
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    ...overrides,
  };
}

function seededRowOf(frontmatter: TicketFrontmatter): Task {
  return TaskFilingUtil.filedTaskOf(SEEDED_ROW_ID, seededFilingOf(frontmatter));
}

describe('ticketStaysOffTheChart', () => {
  // A low ticket waits in the list until somebody starts it; once started it keeps its row through a reopen or an abandon.
  test('only a low ticket never started, while pending or abandoned, stays off the chart', () => {
    expect(ticketStaysOffTheChart(frontmatterFixture({ priority: 'low' }))).toBe(true);
    expect(ticketStaysOffTheChart(frontmatterFixture({ priority: 'low', status: 'abandoned' }))).toBe(true);
    expect(ticketStaysOffTheChart(frontmatterFixture({ priority: 'low', started: STARTED_AT }))).toBe(false);
    expect(ticketStaysOffTheChart(frontmatterFixture({ priority: 'low', status: 'reviewed' }))).toBe(false);
  });

  test('a normal or high ticket, or one that names no priority, is always on the chart', () => {
    for (const status of TICKET_STATUSES) {
      expect(ticketStaysOffTheChart(frontmatterFixture({ status })), status).toBe(false);
      expect(ticketStaysOffTheChart(frontmatterFixture({ status, priority: 'normal' })), status).toBe(false);
      expect(ticketStaysOffTheChart(frontmatterFixture({ status, priority: 'high' })), status).toBe(false);
    }
  });
});

describe('the stored row names', () => {
  test('a ticket\'s own row is named with its id and title', () => {
    expect(rowNameOf(frontmatterFixture())).toBe(TICKET_NAME);
  });

  test('a review bar is named with its round, then the ticket\'s id and title', () => {
    expect(reviewBarNameOf(2, frontmatterFixture())).toBe('Review 2 #003 — Fix the export dialog');
  });
});

describe('seededFilingOf', () => {
  test('a reviewed ticket comes back as a reviewed bar carrying both of its timestamps', () => {
    const seeded = seededRowOf(frontmatterFixture({ status: 'reviewed', started: STARTED_AT, finished: FINISHED_AT }));

    expect(seeded.status).toBe('reviewed');
    expect(seeded.start).toBe(STARTED_AT);
    expect(seeded.end).toBe(FINISHED_AT);
    expect(seeded.name).toBe(TICKET_NAME);
    expect(seeded.ticket).toBe('003');
  });

  test('a ticket delivered without ever being marked finished ends its bar at the delivery', () => {
    const seeded = seededRowOf(frontmatterFixture({ status: 'delivered', started: STARTED_AT, delivered: DELIVERED_AT }));

    expect(seeded.status).toBe('delivered');
    expect(seeded.end).toBe(DELIVERED_AT);
  });

  // `clear` re-seeds rows from tickets; a delivered ticket passed `reviewed`, so its row has to come back marked reviewed.
  test('a reviewed or delivered ticket comes back marked reviewed, and a pending one does not', () => {
    for (const status of ['reviewed', 'delivered'] as const) {
      expect(seededRowOf(frontmatterFixture({ status, finished: FINISHED_AT })).reviewed, status).toBe(FINISHED_AT);
    }
    expect(seededRowOf(frontmatterFixture()).reviewed).toBeUndefined();
  });

  test('an abandoned ticket ends its bar where it was abandoned', () => {
    const seeded = seededRowOf(frontmatterFixture({ status: 'abandoned', started: STARTED_AT, abandonedAt: FINISHED_AT }));

    expect(seeded.status).toBe('abandoned');
    expect(seeded.end).toBe(FINISHED_AT);
  });

  test('a pending ticket comes back as a pending row with no bar at all', () => {
    const seeded = seededRowOf(frontmatterFixture());

    expect(seeded.status).toBe('pending');
    expect(seeded.start).toBeNull();
    expect(seeded.end).toBeNull();
  });
});
