/**
 * The Dependencies tab's waves graph. The cases that matter: the tab exists only where a ticket depends on another; Done comes first and
 * holds only the settled tickets open work was built on; a one-ticket wave is narrow and says so in its head, band and slot meter, whose
 * bar count is the board's slots; the pace path's edges are marked, an edge from a settled ticket is dashed; rows put the pace path first
 * and then follow their parents; nodes carry the ready chip only where the Board lists the ticket ready (a held one shows Held, a low
 * one nothing), "N wait" and a weight bar against the most held ticket; every value is escaped.
 */

import { describe, expect, test } from 'bun:test';
import type { PageTicket }        from '../../src/shared/@types/PagePayload.ts';
import { pageBoardFixture }       from '../testing/PageBoardFixture.ts';
import { DependencyGraphUtil }    from '../utils/DependencyGraphUtil.ts';
import { DependencyMarkup }       from './DependencyMarkup.ts';

function exampleTicket(changes: Partial<PageTicket>): PageTicket {
  return {
    id:          '001',
    title:       'Example ticket',
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

const BOARD_SLOTS = 3;

/**
 * Two parallel chains built on a delivered ticket: 010 (delivered) → 011 → 013 → 014 → 016, and 012 → 015, with 016 the only ticket in the
 * last wave and 014 the only one in wave 3.
 */
const BOARD = pageBoardFixture({
  tasks:   [],
  tickets: [
    exampleTicket({
      id: '010', title: 'Delivered base', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00'
    }),
    exampleTicket({ id: '011', title: 'Schema <first>', dependsOn: ['010'] }),
    exampleTicket({
      id: '012', title: 'Side chain start', status: 'in-progress', started: '2026-09-18T20:30:00+02:00'
    }),
    exampleTicket({ id: '013', title: 'Second step', dependsOn: ['011'] }),
    exampleTicket({ id: '014', title: 'Narrow step', dependsOn: ['013', '012'] }),
    exampleTicket({ id: '015', title: 'Side chain end', dependsOn: ['012'] }),
    exampleTicket({ id: '016', title: 'Last step', dependsOn: ['014'] }),
    exampleTicket({
      id: '017', title: 'Settled, built on by nothing', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00'
    }),
  ],
});

const TICKET_BY_ID = new Map(BOARD.tickets.map((ticket) => [ticket.id, ticket]));
const GRAPH        = DependencyGraphUtil.dependencyGraphOf(BOARD.tickets, BOARD_SLOTS);
const MARKUP       = DependencyMarkup.dependencyGraphMarkup(GRAPH, TICKET_BY_ID, BOARD.readyTicketIds);

/** A held ticket and a low one with nothing open in front of them, beside a normal ticket the Board takes first. */
const HELD_AND_LOW_BOARD = pageBoardFixture({
  tasks:   [],
  tickets: [
    exampleTicket({
      id: '020', title: 'Delivered base', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00'
    }),
    exampleTicket({
      id: '021', title: 'Held step', dependsOn: ['020'], hold: 'not before 2026-10-05'
    }),
    exampleTicket({ id: '022', title: 'Low step', priority: 'low' }),
    exampleTicket({ id: '023', title: 'Normal step' }),
  ],
});
const HELD_AND_LOW_GRAPH  = DependencyGraphUtil.dependencyGraphOf(HELD_AND_LOW_BOARD.tickets, BOARD_SLOTS);
const HELD_AND_LOW_MARKUP = DependencyMarkup.dependencyGraphMarkup(
  HELD_AND_LOW_GRAPH,
  new Map(HELD_AND_LOW_BOARD.tickets.map((ticket) => [ticket.id, ticket])),
  HELD_AND_LOW_BOARD.readyTicketIds,
);

function headsOf(markup: string): string[] {
  return [...markup.matchAll(/class="ap-dependency-head-name">([^<]*)</g)].map((match) => match[1] ?? '');
}

function nodeOf(markup: string, ticketId: string): string {
  return new RegExp(`<button type="button" class="ap-dependency-node" data-open-ticket="${ticketId}"[\\s\\S]*?</button>`).exec(markup)?.[0] ?? '';
}

function nodeTopOf(markup: string, ticketId: string): number {
  return Number(/top:(\d+)px/.exec(nodeOf(markup, ticketId))?.[1]);
}

describe('the Dependencies tab is there only where a ticket depends on another', () => {
  test('a board with a dependsOn has the tab, one without has none', () => {
    expect(DependencyMarkup.boardHasDependencies(BOARD.tickets)).toBe(true);
    expect(DependencyMarkup.boardHasDependencies(pageBoardFixture({ tasks: [], tickets: [exampleTicket({})] }).tickets)).toBe(false);
  });
});

describe('columns', () => {
  test('Done comes first, then one column per wave labelled Now, Wave 2, …', () => {
    expect(headsOf(MARKUP)).toEqual(['Done', 'Now', 'Wave 2', 'Wave 3', 'Wave 4']);
  });

  test('Done holds only the settled tickets open work was built on, and counts them as delivered', () => {
    expect(nodeOf(MARKUP, '010')).toContain('data-done');
    expect(MARKUP).not.toContain('data-open-ticket="017"');
    expect(MARKUP).toContain('<span class="ap-dependency-head-count">1 delivered</span>');
  });

  test('a wave of several says how many run side by side and fills that many of the board\'s slots', () => {
    expect(MARKUP).toContain('<span class="ap-dependency-head-count">2 side by side</span>'
      + '<span class="ap-dependency-slots" role="img" aria-label="2 of 3 slots in use">'
      + '<span class="ap-dependency-slot" data-filled></span><span class="ap-dependency-slot" data-filled></span><span class="ap-dependency-slot"></span></span>');
  });

  test('a one-ticket wave is narrow in its head and its band, and reads "one at a time"', () => {
    const narrowHeads = [...MARKUP.matchAll(/<div class="ap-dependency-head" data-narrow[^>]*>[\s\S]*?<\/div>/g)].map((match) => match[0]);
    expect(narrowHeads).toHaveLength(2);
    expect(narrowHeads[0]).toContain('Wave 3</span><span class="ap-dependency-head-count">one at a time</span>');
    expect([...MARKUP.matchAll(/class="ap-dependency-band" data-narrow/g)]).toHaveLength(2);
  });

  test('the Done column has a dashed band and no slot meter', () => {
    expect(MARKUP).toContain('<div class="ap-dependency-band" data-done');
    expect(/<div class="ap-dependency-head" data-done[^>]*>[\s\S]*?<\/div>/.exec(MARKUP)?.[0]).not.toContain('ap-dependency-slots');
  });
});

describe('rows', () => {
  test('the pace-path ticket leads its column', () => {
    expect(GRAPH.pacePathTicketIds).toEqual(['011', '013', '014', '016']);
    expect(nodeTopOf(MARKUP, '011')).toBeLessThan(nodeTopOf(MARKUP, '012'));
  });

  test('off the pace path, a ticket follows its parents\' rows', () => {
    expect(nodeTopOf(MARKUP, '015')).toBeGreaterThan(nodeTopOf(MARKUP, '013'));
  });
});

describe('edges', () => {
  test('consecutive pace-path tickets are joined by a pace edge', () => {
    expect(MARKUP).toContain('data-from="011" data-to="013" data-pace d="');
    expect(MARKUP).toContain('data-from="014" data-to="016" data-pace d="');
    expect(MARKUP).toContain('data-from="012" data-to="015" d="');
  });

  test('an edge from a settled ticket is dashed', () => {
    expect(MARKUP).toContain('data-from="010" data-to="011" data-settled d="');
  });

  test('an edge is a horizontal cubic from the right middle to the left middle, bending at least 24px', () => {
    expect(MARKUP).toContain('data-from="010" data-to="011" data-settled d="M202 96 C226 96 218 96 242 96"');
  });
});

describe('nodes', () => {
  test('a ready ticket carries the Ready chip, work in progress its state, and plain waiting work none', () => {
    expect(nodeOf(MARKUP, '011')).toContain('<span class="ap-badge" data-ready>Ready</span>');
    expect(nodeOf(MARKUP, '012')).toContain('<span class="ap-badge" data-state="in-progress">In progress</span>');
    expect(nodeOf(MARKUP, '013')).not.toContain('ap-badge');
  });

  test('a held and a low ticket stay in Now without the Ready chip, the held one marked Held, as the Board lists only the normal one', () => {
    expect([...HELD_AND_LOW_BOARD.readyTicketIds]).toEqual(['023']);
    expect(HELD_AND_LOW_GRAPH.waves[0]?.ticketIds.toSorted()).toEqual(['021', '022', '023']);
    expect(nodeOf(HELD_AND_LOW_MARKUP, '021')).toContain('<span class="ap-kanban-held" title="Held: not before 2026-10-05">Held</span>');
    expect(nodeOf(HELD_AND_LOW_MARKUP, '021')).not.toContain('data-ready');
    expect(nodeOf(HELD_AND_LOW_MARKUP, '022')).not.toContain('data-ready');
    expect(nodeOf(HELD_AND_LOW_MARKUP, '022')).not.toContain('ap-kanban-held');
    expect(nodeOf(HELD_AND_LOW_MARKUP, '023')).toContain('<span class="ap-badge" data-ready>Ready</span>');
  });

  test('"N wait" counts every open ticket further down, and the weight bar scales against the most held', () => {
    expect(nodeOf(MARKUP, '011')).toContain('<span class="ap-dependency-wait">3 wait</span>');
    expect(nodeOf(MARKUP, '011')).toContain('style="width:166px"');
    expect(nodeOf(MARKUP, '014')).toContain('<span class="ap-dependency-wait">1 wait</span>');
    expect(nodeOf(MARKUP, '016')).not.toContain('ap-dependency-wait');
    expect(nodeOf(MARKUP, '016')).not.toContain('ap-dependency-weight');
  });

  test('a node opens its ticket and escapes its title once', () => {
    expect(nodeOf(MARKUP, '011')).toContain('data-open-ticket="011"');
    expect(nodeOf(MARKUP, '011')).toContain('Schema &lt;first&gt;');
    expect(MARKUP).not.toContain('<first>');
  });

  test('the legend names the board\'s slots', () => {
    expect(MARKUP).toContain('slot in use (of 3)</li>');
  });
});

describe('a board whose dependencies are all settled', () => {
  test('says that nothing open waits on another', () => {
    const board = pageBoardFixture({
      tasks:   [],
      tickets: [
        exampleTicket({ id: '001', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00' }),
        exampleTicket({
          id: '002', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00', dependsOn: ['001']
        }),
      ],
    });
    const graph  = DependencyGraphUtil.dependencyGraphOf(board.tickets, BOARD_SLOTS);
    const markup = DependencyMarkup.dependencyGraphMarkup(graph, new Map(board.tickets.map((ticket) => [ticket.id, ticket])), board.readyTicketIds);
    expect(markup).toBe('<p class="ap-dependency-empty">No open ticket waits on another.</p>');
  });
});
