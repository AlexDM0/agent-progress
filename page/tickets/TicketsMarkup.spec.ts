/**
 * The Tickets tab's markup: the table rows, the empty result, the chips and the count, with every ticket value escaped exactly once. The
 * cases that matter are the search's marks, which must never split an escaped character, the display-state badge a paused or re-reviewed
 * ticket shows, the priority marks, and that nothing renders a ticket body: the body shows only in the detail panel.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }        from '../../src/shared/@types/PagePayload.ts';
import type { BoardTicket }       from '../@types/PageBoard.ts';
import { pageBoardFixture }       from '../testing/PageBoardFixture.ts';
import {
  emptyTicketTableMarkup,
  matchMarkedMarkup,
  statusChipsMarkup,
  ticketCountText,
  ticketTableRowsMarkup,
  typeChipsMarkup,
} from './TicketsMarkup.ts';
import { DEFAULT_TICKET_VIEW } from './utils/TicketViewUtil.ts';

function exampleTicket(changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id:          '003',
    title:       'Split the exporter into two passes',
    type:        'change',
    status:      'in-review',
    filed:       '2026-09-18T20:44:00+02:00',
    updated:     '2026-09-18T21:49:00+02:00',
    started:     '2026-09-18T21:02:00+02:00',
    finished:    '2026-09-18T21:49:00+02:00',
    delivered:   null,
    abandonedAt: null,
    branch:      'ticket/exporter-passes',
    task:        null,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/003-exporter.md',
    bodyHtml:    '<h2>Report</h2><p>A secret body phrase.</p>',
    ...changes,
  };
}

function boardTicketsOf(tickets: readonly PageTicket[], tasks: readonly Task[] = []): readonly BoardTicket[] {
  return pageBoardFixture({ tasks, tickets }).tickets;
}

describe('ticketTableRowsMarkup', () => {
  test('links the id, badges the display state and keeps the branch', () => {
    const markup = ticketTableRowsMarkup(boardTicketsOf([exampleTicket({ status: 'pending' })]), '');

    expect(markup).toContain('<a href="#ap-ticket-003">#003</a>');
    expect(markup).toContain('<span class="ap-badge" data-state="pending">To do</span>');
    expect(markup).toContain('ticket/exporter-passes');
  });

  // The only thing on a ticket table row that says which ticket it is without parsing a link: the detail panel resolves it from here.
  test('names its ticket on the row itself, and lets the keyboard focus it', () => {
    expect(ticketTableRowsMarkup(boardTicketsOf([exampleTicket()]), '')).toContain('<tr data-ticket-id="003" tabindex="0">');
  });

  test('never renders the ticket body', () => {
    expect(ticketTableRowsMarkup(boardTicketsOf([exampleTicket()]), 'secret')).not.toContain('secret');
  });

  test('puts the waiting note beside the title of a ticket that waits', () => {
    const tickets = boardTicketsOf([exampleTicket({ id: '001', status: 'pending' }), exampleTicket({ status: 'pending', dependsOn: ['001'] })]);

    expect(ticketTableRowsMarkup(tickets, '')).toContain('two passes<span class="ap-waiting">waiting on <a href="#ap-ticket-001">#001</a></span></td>');
  });

  test('marks the search in the title, group and branch, but not an id query', () => {
    const tickets = boardTicketsOf([exampleTicket({ group: 'exporter' })]);

    expect(ticketTableRowsMarkup(tickets, 'Exporter')).toContain('Split the <mark class="ap-match">exporter</mark> into two passes');
    expect(ticketTableRowsMarkup(tickets, 'exporter')).toContain('<td><mark class="ap-match">exporter</mark></td>');
    expect(ticketTableRowsMarkup(tickets, '#003')).not.toContain('<mark');
  });

  test('escapes a hostile ticket title', () => {
    expect(ticketTableRowsMarkup(boardTicketsOf([exampleTicket({ title: '<b>bold</b>' })]), '')).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

describe('matchMarkedMarkup', () => {
  test('marks every occurrence, whatever its case', () => {
    expect(matchMarkedMarkup('Dark mode, darker', 'dark')).toBe('<mark class="ap-match">Dark</mark> mode, <mark class="ap-match">dark</mark>er');
  });

  // Marking after escaping would let "amp" match inside "&amp;" and break the entity.
  test('never matches inside an escaped character', () => {
    expect(matchMarkedMarkup('Q&A', 'amp')).toBe('Q&amp;A');
    expect(matchMarkedMarkup('a <b> c', '<b>')).toBe('a <mark class="ap-match">&lt;b&gt;</mark> c');
  });

  test('escapes the text when there is nothing to mark', () => {
    expect(matchMarkedMarkup('<i>', '')).toBe('&lt;i&gt;');
  });
});

describe('emptyTicketTableMarkup', () => {
  test('says what was asked and offers the way back', () => {
    const markup = emptyTicketTableMarkup({
      ...DEFAULT_TICKET_VIEW, searchText: 'refund', statusChips: ['paused', 'reviewing'], typeChips: ['bug']
    });

    expect(markup).toContain('<td colspan="7">');
    expect(markup).toContain('No ticket matches “refund”, status Paused or Reviewing, type bug.');
    expect(markup).toContain('data-clear-filters');
  });

  test('escapes the search it repeats', () => {
    expect(emptyTicketTableMarkup({ ...DEFAULT_TICKET_VIEW, searchText: '<script>' })).toContain('“&lt;script&gt;”');
  });

  test('offers no way back when nothing narrowed the table', () => {
    expect(emptyTicketTableMarkup(DEFAULT_TICKET_VIEW)).not.toContain('data-clear-filters');
  });
});

describe('the chips', () => {
  test('label a status chip with its state and dot, unpressed', () => {
    expect(statusChipsMarkup(['reviewing'])).toBe(
      '<button type="button" class="ap-chip" data-status="reviewing" data-state="reviewing" aria-pressed="false">'
      + '<span class="ap-lane-dot" data-state="reviewing"></span>Reviewing <span class="ap-chip-count"></span></button>',
    );
  });

  test('label a type chip with its type', () => {
    expect(typeChipsMarkup(['bug'])).toBe('<button type="button" class="ap-chip" data-type="bug" aria-pressed="false">bug <span class="ap-chip-count"></span></button>');
  });
});

describe('ticketCountText', () => {
  test.each([
    ['no tickets', 0, []],
    ['1 of 1 ticket', 1, [exampleTicket({ status: 'pending' })]],
    ['1 of 2 tickets · 1 in progress', 1, [exampleTicket({ status: 'pending' }), exampleTicket({ id: '004', status: 'in-progress' })]],
  ])('reads %s', (expected, shownCount, tickets) => {
    expect(ticketCountText(shownCount as number, tickets as PageTicket[])).toBe(expected);
  });
});

// The template is designer-owned, so a priority borrows two marks it already styles; a new class here would render unstyled.
describe('the priority marks on the Tickets tab', () => {
  test('marks a low ticket low, one space off its title, with an empty task cell while it has no row', () => {
    const tableRow = ticketTableRowsMarkup(boardTicketsOf([exampleTicket({ priority: 'low', status: 'pending' })]), '');

    expect(tableRow).toMatch(/two passes <span class="ap-ticket-badge" data-priority="low" title="[^"]+">low<\/span><\/td>/);
    expect(tableRow).toContain('<td class="mono"></td></tr>');
  });

  test('marks a high ticket high, and leaves a normal one unmarked', () => {
    const highRow = ticketTableRowsMarkup(boardTicketsOf([exampleTicket({ priority: 'high' })]), '');

    expect(highRow).toMatch(/two passes<span class="ap-waiting" data-priority="high" title="[^"]+">high<\/span><\/td>/);
    expect(ticketTableRowsMarkup(boardTicketsOf([exampleTicket({ priority: 'normal' })]), '')).not.toContain('data-priority');
  });
});
