/**
 * The epic marks. The cases that matter: a chip carries its key and colour slot and escapes its title once, a card shows two chips then
 * "+N"; the roll-up bar and facts come from the Board's counts; an epic's ticket list opens each ticket and names its other epics; the
 * detail carries the rendered description unescaped; open epics come before settled ones; and the filter chips end with the no-epic chip.
 * A card's dependency rows count each ticket under its primary epic alone, say so when there is nothing, and draw the global waves.
 */

import { describe, expect, test }           from 'bun:test';
import type { EpicFrontmatter }             from '../../src/lib/tracker-model/@types/Epic.ts';
import type { PageTicket }                  from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic, BoardTicket }      from '../@types/PageBoard.ts';
import { pageBoardFixture }                 from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }              from '../testing/PageLimitsFixture.ts';
import { DependencyGraphUtil }              from '../utils/DependencyGraphUtil.ts';
import { CARD_EPIC_CHIP_LIMIT, EpicMarkup } from './EpicMarkup.ts';

const BOARD_SLOTS = 5;

function exampleTicket(changes: Partial<PageTicket>): PageTicket {
  return {
    id:          '001',
    title:       'Single-page checkout',
    type:        'feature',
    status:      'pending',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/001-example.md',
    bodyHtml:    '',
    ...changes,
  };
}

const EPICS: EpicFrontmatter[] = [
  {
    key: 'checkout-redesign', title: 'Checkout <redesign>', slot: 1, extra: []
  },
  {
    key: 'order-emails', title: 'Order emails', slot: 2, extra: []
  },
  {
    key: 'payment-providers', title: 'Payment providers', slot: 3, extra: []
  },
];

const BOARD = pageBoardFixture({
  tasks:   [],
  tickets: [
    exampleTicket({ id: '001', epics: ['checkout-redesign', 'order-emails', 'payment-providers'] }),
    exampleTicket({
      id: '002', title: 'Receipt mail', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00', epics: ['order-emails']
    }),
    exampleTicket({ id: '003', title: 'No epic at all' }),
  ],
  epics: EPICS,
});

const TICKET_BY_ID = new Map(BOARD.tickets.map((ticket) => [ticket.id, ticket]));
const FORMAT       = { limits: EXAMPLE_PAGE_LIMITS, todayCalendarDate: '2026-09-18', nowEpochMilliseconds: Date.parse('2026-09-18T22:00:00+02:00') };

function epicNamed(key: string): BoardEpic {
  const epic = BOARD.epics.find((candidate) => candidate.key === key);
  if (epic === undefined) throw new Error(`no epic ${key}`);
  return epic;
}

function ticketNamed(id: string): BoardTicket {
  const ticket = TICKET_BY_ID.get(id);
  if (ticket === undefined) throw new Error(`no ticket ${id}`);
  return ticket;
}

describe('epicChipsMarkup', () => {
  test('gives each chip its key and slot, and escapes the title once', () => {
    const markup = EpicMarkup.epicChipsMarkup([epicNamed('checkout-redesign')]);

    expect(markup).toContain('data-epic="checkout-redesign" data-epic-slot="1"');
    expect(markup).toContain('<span class="ap-epic-chip-text">Checkout &lt;redesign&gt;</span>');
  });

  test('shows two chips on a card, then a "+N" naming the rest', () => {
    const markup = EpicMarkup.epicChipsMarkup(ticketNamed('001').memberOfEpics, CARD_EPIC_CHIP_LIMIT);

    expect(markup.match(/class="ap-epic-chip"/g)?.length).toBe(2);
    expect(markup).toContain('<span class="ap-epic-more" title="Also in Payment providers">+1</span>');
  });
});

describe('epicDetailMarkup', () => {
  test('carries the roll-up, the rendered description unescaped and the epic\'s tickets, newest first', () => {
    const markup = EpicMarkup.epicDetailMarkup(epicNamed('order-emails'), TICKET_BY_ID, FORMAT);

    expect(markup).toContain('<div class="ap-epic-detail" data-epic-slot="2">');
    expect(markup).toContain('<span class="ap-detail-type">1 open</span>');
    expect(markup).toContain('<div><b>open</b><span>1</span></div><div><b>done</b><span>1</span></div>');
    expect(markup).toContain('<span data-state="delivered" style="flex-grow:1"');
    expect(markup).toContain('<div class="ap-ticket-body md"><p>The Order emails epic.</p></div>');
    expect(markup.indexOf('data-open-ticket="002"')).toBeLessThan(markup.indexOf('data-open-ticket="001"'));
  });

  test('names a listed ticket\'s other epics beside its title', () => {
    const markup = EpicMarkup.epicDetailMarkup(epicNamed('order-emails'), TICKET_BY_ID, FORMAT);

    expect(markup).toContain('title="Also in Checkout &lt;redesign&gt;, Payment providers">also in ');
  });
});

describe('epicCardsMarkup', () => {
  test('puts the open epics before the settled ones', () => {
    const settled = pageBoardFixture({
      tasks:   [],
      tickets: [exampleTicket({
        id: '004', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00', epics: ['checkout-redesign']
      }), exampleTicket({ id: '005', epics: ['order-emails'] })],
      epics: EPICS.slice(0, 2),
    });
    const graph  = DependencyGraphUtil.dependencyGraphOf(settled.tickets, BOARD_SLOTS);
    const markup = EpicMarkup.epicCardsMarkup(settled.epics, new Map(settled.tickets.map((ticket) => [ticket.id, ticket])), graph, FORMAT);

    expect(markup.indexOf('data-open-epic="order-emails"')).toBeLessThan(markup.indexOf('data-open-epic="checkout-redesign"'));
    expect(markup).toContain('<span class="ap-epic-done-mark">all settled</span>');
    expect(markup).toContain('<p class="ap-epic-summary">The Order emails epic.</p>');
  });
});

describe('epicCardsMarkup dependency rows', () => {
  const linked = pageBoardFixture({
    tasks:   [],
    tickets: [
      exampleTicket({
        id: '010', title: 'Checkout schema', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00', epics: ['checkout-redesign']
      }),
      exampleTicket({
        id: '011', title: 'Checkout form', dependsOn: ['010'], epics: ['checkout-redesign']
      }),
      exampleTicket({
        id: '020', title: 'Retry <failed> sends', dependsOn: ['011'], epics: ['order-emails', 'checkout-redesign']
      }),
      exampleTicket({
        id: '021', title: 'Receipt layout', dependsOn: ['011', '020'], epics: ['order-emails']
      }),
      exampleTicket({
        id: '030', title: 'Card provider', dependsOn: ['020'], epics: ['payment-providers', 'order-emails']
      }),
    ],
    epics: EPICS,
  });
  const linkedTicketById = new Map(linked.tickets.map((ticket) => [ticket.id, ticket]));
  const linkedGraph      = DependencyGraphUtil.dependencyGraphOf(linked.tickets, BOARD_SLOTS);

  function cardOf(key: string): string {
    const epic = linked.epics.find((candidate) => candidate.key === key);
    if (epic === undefined) throw new Error(`no epic ${key}`);
    return EpicMarkup.epicCardsMarkup([epic], linkedTicketById, linkedGraph, FORMAT);
  }

  test('lists the tickets of other primary epics it waits on, and the epics waiting on it with the ids they wait through', () => {
    expect(cardOf('order-emails')).toContain(
      '<span class="ap-epic-link-label">Waits on</span><button type="button" class="ap-epic-link-chip" data-open-ticket="011" data-epic-slot="1" '
      + 'title="#011 Checkout form"><span class="ap-epic-swatch"></span><span class="ap-ticket-id">#011</span>'
      + '<span class="ap-epic-link-epic">Checkout &lt;redesign&gt;</span></button></div>'
    );
    expect(cardOf('checkout-redesign')).toContain(
      '<span class="ap-epic-link-label">Frees</span><button type="button" class="ap-epic-link-chip" data-frees data-open-epic="order-emails" '
      + 'data-epic-slot="2" title="Order emails via #011"><span class="ap-epic-swatch"></span><span>Order emails</span>'
      + '<span class="ap-epic-link-via">via #011</span></button></div>'
    );
  });

  test('counts a ticket in several epics under its primary epic alone', () => {
    const checkoutCard = cardOf('checkout-redesign');
    const paymentsCard = cardOf('payment-providers');

    expect(checkoutCard).not.toContain('data-open-ticket="020" data-state');
    expect(checkoutCard).not.toContain('Payment providers');
    expect(paymentsCard).toContain('data-open-ticket="020" data-epic-slot="2"');
    expect(cardOf('order-emails')).toContain('data-open-epic="payment-providers"');
    expect(cardOf('order-emails')).not.toContain('data-open-ticket="030" data-state');
  });

  test('says so when nothing outside waits or is waited on', () => {
    expect(cardOf('checkout-redesign')).toContain('<span class="ap-epic-link-label">Waits on</span><span class="ap-epic-link-empty">Nothing outside this epic</span>');
    expect(cardOf('payment-providers')).toContain('<span class="ap-epic-link-label">Frees</span><span class="ap-epic-link-empty">No other epic waits on this one</span>');
  });

  test('shows Done first, then each global wave holding its tickets, narrow where the whole wave is one ticket', () => {
    const checkoutCard = cardOf('checkout-redesign');
    const emailsCard   = cardOf('order-emails');

    expect(checkoutCard).toContain('<div class="ap-epic-waves"><div class="ap-epic-wave" data-done><span class="ap-epic-wave-name">Done</span>'
      + '<button type="button" class="ap-epic-wave-pill" data-open-ticket="010" data-state="delivered" data-done title="Checkout schema">');
    expect(checkoutCard).toContain('<div class="ap-epic-wave" data-narrow><span class="ap-epic-wave-name">Now</span>');
    expect(emailsCard).toContain('<div class="ap-epic-waves"><div class="ap-epic-wave" data-narrow><span class="ap-epic-wave-name">Wave 2</span>'
      + '<button type="button" class="ap-epic-wave-pill" data-open-ticket="020" data-state="pending" data-narrow title="Retry &lt;failed&gt; sends">'
      + '<span class="ap-ticket-id">#020</span><span class="ap-epic-wave-title">Retry &lt;failed&gt; sends</span></button></div>');
    expect(emailsCard).toContain('<div class="ap-epic-wave"><span class="ap-epic-wave-name">Wave 3</span>'
      + '<button type="button" class="ap-epic-wave-pill" data-open-ticket="021" data-state="pending" title="Receipt layout">');
    expect(linkedGraph.waves.map((wave) => wave.isNarrow)).toEqual([true, true, false]);
  });

  test('keeps the strip on a card whose epic holds no ticket as its primary', () => {
    const emptyBoard = pageBoardFixture({ tasks: [], tickets: [], epics: EPICS.slice(0, 1) });
    const markup     = EpicMarkup.epicCardsMarkup(emptyBoard.epics, new Map(), DependencyGraphUtil.dependencyGraphOf([], BOARD_SLOTS), FORMAT);

    expect(markup).toContain('<div class="ap-epic-waves"><span class="ap-epic-link-empty">No tickets under this epic</span></div>');
  });
});

describe('epicFilterChipsMarkup', () => {
  test('offers one chip per epic, then the no-epic chip', () => {
    const markup = EpicMarkup.epicFilterChipsMarkup(BOARD.epics);

    expect(markup.match(/data-epic-chip=/g)?.length).toBe(4);
    expect(markup).toMatch(/data-epic-chip="no epic" aria-pressed="false">no epic <span class="ap-chip-count"><\/span><\/button>$/);
  });
});

describe('epicGroupRowMarkup', () => {
  test('heads an epic\'s rows with its title and roll-up across every column, and the tickets in none with "No epic"', () => {
    const epicRow = EpicMarkup.epicGroupRowMarkup(epicNamed('order-emails'), 7, FORMAT);

    expect(epicRow).toContain('<td colspan="7"><div class="ap-epic-group-line"><button type="button" class="ap-epic-title" data-open-epic="order-emails">');
    expect(EpicMarkup.epicGroupRowMarkup(null, 6, FORMAT)).toContain('<td colspan="6"><div class="ap-epic-group-line"><span class="ap-epic-title">No epic</span>');
  });
});
