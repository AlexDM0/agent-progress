/**
 * The Tickets tab's markup: the table rows, the count and the cards, with every ticket value escaped exactly once. The cases that matter
 * are the collapsed closed cards, the milestone and meta stamps shortened against the viewer's day, and the priority marks.
 */

import { describe, expect, test }                                    from 'bun:test';
import type { TicketStatus }                                         from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { PageTicket }                                           from '../../src/shared/@types/PagePayload.ts';
import { EXAMPLE_TIMESTAMP_SLICES }                                  from '../testing/PageLimitsFixture.ts';
import { ticketCardsMarkup, ticketCountText, ticketTableRowsMarkup } from './TicketsMarkup.ts';

/** The example board's own day: its stamps from the 18th print as a clock, the rest dated. */
const EXAMPLE_TODAY = '2026-09-18';

const NO_WAITING = new Map<string, string[]>();

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
    task:        3,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/003-exporter.md',
    bodyHtml:    '<h2>Report</h2>',
    ...changes,
  };
}

describe('ticketTableRowsMarkup', () => {
  test('links the id and the task, and badges the status', () => {
    const markup = ticketTableRowsMarkup([exampleTicket()], NO_WAITING);

    expect(markup).toContain('<a href="#ap-ticket-003">#003</a>');
    expect(markup).toContain('<a href="#ap-task-3">#3</a>');
    expect(markup).toContain('<span class="ap-badge in-review">in-review</span>');
    expect(markup).toContain('ticket/exporter-passes');
  });

  // The only thing on a ticket table row that says which ticket it is without parsing a link: the detail panel resolves it from here.
  // The tabindex is what lets Enter open the same panel for a keyboard user.
  test('names its ticket on the row itself, and lets the keyboard focus it', () => {
    expect(ticketTableRowsMarkup([exampleTicket()], NO_WAITING)).toContain('<tr data-ticket-id="003" tabindex="0">');
  });

  test('leaves the task cell empty for a ticket with no row yet', () => {
    expect(ticketTableRowsMarkup([exampleTicket({ task: null })], NO_WAITING)).toContain('<td class="mono"></td></tr>');
  });

  test('puts the waiting note beside the title of a ticket that waits', () => {
    const waiting = new Map([['003', ['001']]]);

    expect(ticketTableRowsMarkup([exampleTicket()], waiting)).toContain('two passes<span class="ap-waiting">waiting on <a href="#ap-ticket-001">#001</a></span></td>');
  });

  test('escapes a hostile ticket title', () => {
    expect(ticketTableRowsMarkup([exampleTicket({ title: '<b>bold</b>' })], NO_WAITING)).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

describe('ticketCountText', () => {
  test.each([
    ['no tickets', []],
    ['1 ticket', [exampleTicket({ status: 'pending' })]],
    ['2 tickets · 1 in progress', [exampleTicket({ status: 'pending' }), exampleTicket({ id: '004', status: 'in-progress' })]],
  ])('reads %s', (expected, tickets) => {
    expect(ticketCountText(tickets as PageTicket[])).toBe(expected);
  });
});

describe('ticketCardsMarkup', () => {
  test('lists every dependency in the card, and heads a waiting card with what it still waits on', () => {
    const markup = ticketCardsMarkup([exampleTicket({ dependsOn: ['001', '002'] })], new Map([['003', ['002']]]), EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).toContain('<b>waits on</b><span><a href="#ap-ticket-001">#001</a>, <a href="#ap-ticket-002">#002</a></span>');
    expect(markup).toContain('<span class="ap-waiting">waiting on <a href="#ap-ticket-002">#002</a></span>');
  });

  test.each<[TicketStatus]>([['pending'], ['in-progress'], ['in-review']])('leaves a %s card open, with no disclosure', (status) => {
    const markup = ticketCardsMarkup([exampleTicket({ status })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).toContain('<div class="ap-ticket-head">');
    expect(markup).not.toContain('<details>');
  });

  test.each<[TicketStatus]>([['reviewed'], ['delivered'], ['abandoned']])('collapses a %s card into a disclosure', (status) => {
    const markup = ticketCardsMarkup([exampleTicket({ status })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).toContain('<details><summary>');
    expect(markup).not.toContain('ap-ticket-head');
  });

  test('keeps the id on the outer section either way', () => {
    for (const status of ['pending', 'reviewed'] as const) {
      expect(ticketCardsMarkup([exampleTicket({ status })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY)).toContain('<section class="ap-ticket" id="ap-ticket-003">');
    }
  });

  test('shows the latest milestone the ticket reached, not the first', () => {
    const delivered = ticketCardsMarkup([exampleTicket({ status: 'delivered', delivered: '2026-09-18T21:51:00+02:00' })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);
    const filedOnly = ticketCardsMarkup([exampleTicket({ started: null, finished: null })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(delivered).toContain('<span class="ap-ticket-dates" title="delivered 2026-09-18 21:51">delivered 21:51</span>');
    expect(filedOnly).toContain('<span class="ap-ticket-dates" title="filed 2026-09-18 20:44">filed 20:44</span>');
  });

  // The head once printed a bare clock whatever the day; a milestone from yesterday read as today's.
  test('dates a head milestone from another day, and shows one from another year in full with no title', () => {
    const yesterday = ticketCardsMarkup([exampleTicket({ status: 'delivered', delivered: '2026-09-17T23:48:00+02:00' })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);
    const lastYear  = ticketCardsMarkup(
      [exampleTicket({ started: null, finished: null, filed: '2025-12-31T23:48:00+01:00' })],
      NO_WAITING,
      EXAMPLE_TIMESTAMP_SLICES,
      EXAMPLE_TODAY,
    );

    expect(yesterday).toContain('<span class="ap-ticket-dates" title="delivered 2026-09-17 23:48">delivered 09-17 23:48</span>');
    expect(lastYear).toContain('<span class="ap-ticket-dates">filed 2025-12-31 23:48</span>');
    expect(lastYear).toContain('<div><b>filed</b><span>2025-12-31 23:48</span></div>');
  });

  test('shortens the timestamps in the meta list, titled with the full stamp, and leaves the branch whole', () => {
    const markup = ticketCardsMarkup([exampleTicket({ commit: '4f1e9c0abcdef' })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).toContain('<div><b>filed</b><span title="2026-09-18 20:44">20:44</span></div>');
    expect(markup).toContain('<div><b>branch</b><span>ticket/exporter-passes</span></div>');
    expect(markup).toContain('<div><b>commit</b><span>4f1e9c0abcdef</span></div>');
  });

  test('leaves out the meta entries the ticket never recorded', () => {
    const markup = ticketCardsMarkup([exampleTicket({ started: null, finished: null })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).not.toContain('<b>started</b>');
    expect(markup).not.toContain('<b>finished</b>');
  });

  test('places the pre-rendered body verbatim inside the markdown container', () => {
    const markup = ticketCardsMarkup([exampleTicket({ bodyHtml: '<h2>Report</h2><p>one</p>' })], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).toContain('<div class="ap-ticket-body md"><h2>Report</h2><p>one</p></div>');
  });
});

// The template is designer-owned, so a priority borrows two marks it already styles; a new class here would render unstyled.
describe('the priority marks on the Tickets tab', () => {
  const LOW_MARK_OPENING  = '<span class="ap-ticket-badge" data-priority="low"';
  const HIGH_MARK_OPENING = '<span class="ap-waiting" data-priority="high"';

  test('marks a low ticket low, beside its title in the table and after its status in the card, with an empty task cell while it has no row', () => {
    const lowTicket = exampleTicket({ priority: 'low', status: 'pending', task: null });
    const tableRow  = ticketTableRowsMarkup([lowTicket], NO_WAITING);
    const card      = ticketCardsMarkup([lowTicket], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(tableRow).toMatch(/two passes <span class="ap-ticket-badge" data-priority="low" title="[^"]+">low<\/span><\/td>/);
    expect(tableRow).toContain('<td class="mono"></td></tr>');
    expect(card).toMatch(/<span class="ap-badge pending">pending<\/span> <span class="ap-ticket-badge" data-priority="low" title="[^"]+">low<\/span>/);
    expect(card).not.toContain('<b>task</b>');
  });

  test('marks a high ticket high, in the table and in the card', () => {
    const highTicket = exampleTicket({ priority: 'high' });

    expect(ticketTableRowsMarkup([highTicket], NO_WAITING)).toMatch(/two passes<span class="ap-waiting" data-priority="high" title="[^"]+">high<\/span><\/td>/);
    expect(ticketCardsMarkup([highTicket], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY)).toContain(HIGH_MARK_OPENING);
  });

  test('leaves a normal ticket, and one whose file carries no priority, unmarked', () => {
    for (const ticket of [exampleTicket({ priority: 'normal' }), exampleTicket()]) {
      const markup = ticketTableRowsMarkup([ticket], NO_WAITING) + ticketCardsMarkup([ticket], NO_WAITING, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);
      expect(markup).not.toContain('data-priority');
    }
    expect(ticketTableRowsMarkup([exampleTicket({ priority: 'low' })], NO_WAITING)).toContain(LOW_MARK_OPENING);
  });
});
