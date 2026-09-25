/**
 * How a task or ticket is marked wherever the page shows it. Every expected string is the markup the page printed before these marks were
 * gathered here, so a merged copy that drifts by one character fails; the status badge prints the raw stored status.
 */

import { describe, expect, test } from 'bun:test';

import type { Task }            from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }      from '../../src/shared/@types/PagePayload.ts';
import type { TimestampSlices } from './TimeUtil.ts';
import { WorkItemMarkupUtil }   from './WorkItemMarkupUtil.ts';

const {
  latestMilestoneMarkup,
  pillLabelForRowState,
  priorityMarkMarkup,
  reviewedMarkMarkup,
  taskLinkMarkup,
  ticketBadgeMarkup,
  ticketLinksMarkup,
  ticketStatusBadgeMarkup,
  waitingOnMarkup,
} = WorkItemMarkupUtil;

const EXAMPLE_TODAY = '2026-09-18';

const EXAMPLE_SLICES: TimestampSlices = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     3,
    name:   'Split the exporter',
    status: 'delivered',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id:          '003',
    title:       'Split the exporter',
    type:        'change',
    status:      'in-review',
    filed:       '2026-09-17T20:44:00+02:00',
    updated:     '2026-09-18T21:49:00+02:00',
    started:     '2026-09-18T21:02:00+02:00',
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        3,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/003-exporter.md',
    bodyHtml:    '',
    ...changes,
  };
}

describe('ticketLinksMarkup', () => {
  test('links each ticket to its card on the Tickets tab by default, joined by a comma', () => {
    expect(ticketLinksMarkup(['003', '012'])).toBe('<a href="#ap-ticket-003">#003</a>, <a href="#ap-ticket-012">#012</a>');
  });

  test('links each ticket to its Kanban card, marked for the page script to follow', () => {
    expect(ticketLinksMarkup(['003', '012'], 'kanban-card'))
      .toBe('<a href="#ap-kanban-003" data-ticket-link="003">#003</a>, <a href="#ap-kanban-012" data-ticket-link="012">#012</a>');
  });
});

describe('waitingOnMarkup', () => {
  test('writes nothing for a ticket that waits on nothing', () => {
    expect(waitingOnMarkup([])).toBe('');
  });

  test('names what a ticket waits on, linked to the given target', () => {
    expect(waitingOnMarkup(['003'], 'kanban-card'))
      .toBe('<span class="ap-waiting">waiting on <a href="#ap-kanban-003" data-ticket-link="003">#003</a></span>');
  });
});

describe('taskLinkMarkup', () => {
  test('writes nothing for a ticket with no row', () => {
    expect(taskLinkMarkup(null)).toBe('');
  });

  test('links a row by its number', () => {
    expect(taskLinkMarkup(3)).toBe('<a href="#ap-task-3">#3</a>');
  });
});

describe('ticketBadgeMarkup', () => {
  test('badges a row with a link to its ticket card', () => {
    expect(ticketBadgeMarkup('003')).toBe('<a class="ap-ticket-badge" href="#ap-ticket-003">#003</a>');
  });
});

describe('ticketStatusBadgeMarkup', () => {
  test('prints the raw stored status as both the class and the text', () => {
    expect(ticketStatusBadgeMarkup('in-review')).toBe('<span class="ap-badge in-review">in-review</span>');
  });
});

describe('priorityMarkMarkup', () => {
  test('marks a low ticket with the quiet badge', () => {
    expect(priorityMarkMarkup(exampleTicket({ priority: 'low' }))).toBe('<span class="ap-ticket-badge" data-priority="low" title="Low priority: no row on the chart'
      + ' until it is started, and worked once no normal or high ticket is left undelivered">low</span>');
  });

  test('leaves a normal ticket unmarked', () => {
    expect(priorityMarkMarkup(exampleTicket({ priority: 'normal' }))).toBe('');
  });

  test('marks a high ticket with the amber note', () => {
    expect(priorityMarkMarkup(exampleTicket({ priority: 'high' })))
      .toBe('<span class="ap-waiting" data-priority="high" title="High priority: dispatched before every normal ticket">high</span>');
  });
});

describe('reviewedMarkMarkup', () => {
  test('titles the mark with the review time when the row carries one', () => {
    expect(reviewedMarkMarkup(exampleTask({ reviewed: '2026-09-18T21:30:00+02:00' }), EXAMPLE_SLICES))
      .toBe('<span class="ap-reviewed-mark" data-state="reviewed" title="Reviewed 2026-09-18 21:30 before delivery" role="img" aria-label="reviewed">✓</span>');
  });

  test('titles the mark without a time when the row carries no review stamp', () => {
    expect(reviewedMarkMarkup(exampleTask(), EXAMPLE_SLICES))
      .toBe('<span class="ap-reviewed-mark" data-state="reviewed" title="Reviewed before delivery" role="img" aria-label="reviewed">✓</span>');
  });
});

describe('pillLabelForRowState', () => {
  test('appends the round to a repeat review and to nothing else', () => {
    expect(pillLabelForRowState('re-review', 3)).toBe('reviewing 3');
    expect(pillLabelForRowState('reviewing', 3)).toBe('reviewing');
  });
});

describe('latestMilestoneMarkup', () => {
  test('shows the newest milestone the ticket reached under the Tickets tab class', () => {
    expect(latestMilestoneMarkup(exampleTicket(), EXAMPLE_SLICES, EXAMPLE_TODAY))
      .toBe('<span class="ap-ticket-dates" title="started 2026-09-18 21:02">started 21:02</span>');
  });

  test('takes the class it is given', () => {
    expect(latestMilestoneMarkup(exampleTicket({ delivered: '2026-09-18T22:10:00+02:00' }), EXAMPLE_SLICES, EXAMPLE_TODAY, 'ap-kanban-date'))
      .toBe('<span class="ap-kanban-date" title="delivered 2026-09-18 22:10">delivered 22:10</span>');
  });

  test('writes nothing for a ticket with no stamps', () => {
    expect(latestMilestoneMarkup(exampleTicket({ filed: '', started: null }), EXAMPLE_SLICES, EXAMPLE_TODAY)).toBe('');
  });
});
