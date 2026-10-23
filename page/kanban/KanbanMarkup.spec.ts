/**
 * The Kanban markup against the template's placeholder board, which is the contract: the To do lane, three cards and the Done footer are
 * rebuilt from constructed inputs and must match the template's text exactly. Then the parts the placeholder does not show: the cap's
 * buttons, the empty lanes under Show all, the Abandoned toggle, each lane head's hover (the old subtitle, one line of plain text, none
 * when empty) and the escaping. Last the dependency views: To do by wave (groups, the narrow tint, the head's hover and the order within a
 * group) and each card's "needed first" slot and `↦ N`, absent on a board without
 * dependencies so the filed board stays byte for byte as it was, `↦ N` sharing the head's end with the token count so the two never overlap.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }        from '../../src/shared/@types/PagePayload.ts';
import { pageBoardFixture }       from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }    from '../testing/PageLimitsFixture.ts';
import { DependencyGraphUtil }    from '../utils/DependencyGraphUtil.ts';
import type { KanbanBoardInput }  from './@types/KanbanBoardInput.ts';
import { kanbanCardFormatOf }     from './KanbanBoardModel.ts';
import {
  cappedLaneFooterMarkup,
  kanbanBoardMarkup,
  kanbanCardMarkup,
  kanbanLaneMarkup,
} from './KanbanMarkup.ts';
import { KanbanLaneUtil } from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil } from './utils/LanePagingUtil.ts';

const { cappedLaneShownCount, shownCountAfterMore } = LanePagingUtil;

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_BOARD_SLOTS         = 5;
const PLACEHOLDER_DONE_LANE_COUNT = 18;
const MINUTES_BETWEEN_DELIVERIES  = 20;
const MILLISECONDS_PER_MINUTE     = 60_000;

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'pending',
    filed:       at('08:00'),
    updated:     at('08:00'),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '',
    ...changes,
  };
}

function exampleRow(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example row ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function boardInput(tickets: readonly PageTicket[], tasks: readonly Task[], changes: Partial<KanbanBoardInput> = {}): KanbanBoardInput {
  const waitingOnById = new Map(tickets.flatMap((ticket) => (ticket.dependsOn === undefined ? [] : [[ticket.id, ticket.dependsOn]])));
  const board         = pageBoardFixture({ tasks, tickets });
  const boardTickets  = board.tickets;
  return {
    cards:                   KanbanLaneUtil.kanbanCardsFor(boardTickets, waitingOnById),
    todoOrder:               'filed',
    dependencyGraph:         DependencyGraphUtil.dependencyGraphOf(boardTickets, EXAMPLE_BOARD_SLOTS),
    readyTicketIds:          board.readyTicketIds,
    nowEpochMilliseconds:    EXAMPLE_NOW,
    todayCalendarDate:       EXAMPLE_TODAY,
    slices:                  EXAMPLE_PAGE_LIMITS,
    finishedWork:            '1d',
    hiddenCountByClosedLane: { done: 0, abandoned: 0 },
    shownCountByClosedLane:  { done: 15, abandoned: 15 },
    abandonedLaneIsOpen:     false,
    ...changes,
  };
}

/** The wall clock `minutes` before the example day's end, on that day or the ones before it. */
function stampMinutesBeforeMidnight(minutes: number): string {
  const moment = new Date(Date.UTC(2026, 8, 26) - minutes * MILLISECONDS_PER_MINUTE).toISOString();
  return at(moment.slice(11, 16), moment.slice(0, 10));
}

const MINUTES_FROM_THE_FIRST_DELIVERY_TO_MIDNIGHT = 632;

/** One generator for every Done ticket, delivered one every 20 minutes back from 13:28. */
function deliveredTickets(count: number): { tickets: PageTicket[]; tasks: Task[] } {
  const tickets = Array.from({ length: count }, (_unused, index) => exampleTicket(String(100 + index).padStart(3, '0'), {
    status:    'delivered',
    delivered: stampMinutesBeforeMidnight(MINUTES_FROM_THE_FIRST_DELIVERY_TO_MIDNIGHT + index * MINUTES_BETWEEN_DELIVERIES),
  }));
  const tasks = tickets.map((ticket, index) => exampleRow(index + 1, { status: 'delivered', ticket: ticket.id }));
  return { tickets, tasks };
}

const templateText = await Bun.file(`${import.meta.dir}/../../resources/template.html`).text();

function placeholderLane(lane: string): string {
  return templateText.split('\n').find((line) => line.includes(`<section class="ap-card ap-lane" data-lane="${lane}"`))?.trim() ?? '';
}

function placeholderCard(ticketId: string): string {
  return new RegExp(`<article class="ap-kanban-card" id="ap-kanban-${ticketId}"[\\s\\S]*?</article>`).exec(templateText)?.[0] ?? '';
}

const TODO_TICKETS: PageTicket[] = [
  exampleTicket('064', {
    title:    'Checkout button double-submits on a slow network',
    type:     'bug',
    priority: 'high',
    filed:    at('13:02'),
    task:     22,
  }),
  exampleTicket('065', {
    title:     'Wishlist share link',
    filed:     at('11:20'),
    task:      20,
    dependsOn: ['060'],
  }),
  exampleTicket('066', {
    title: 'Rename basket to cart in order e-mails',
    type:  'ticket',
    filed: at('09:50'),
    task:  16,
    hold:  'Waiting for copy from marketing',
  }),
  exampleTicket('067', { title: 'Sort orders by delivery date', filed: at('10:12'), task: 17 }),
  exampleTicket('068', {
    title:    'Footer links wrap on tablets',
    type:     'bug',
    priority: 'low',
    filed:    at('17:40', '2026-09-24'),
  }),
  exampleTicket('069', {
    title:    'Admin table column widths jump on sort',
    type:     'bug',
    priority: 'low',
    filed:    at('12:05'),
  }),
];
const TODO_ROWS: Task[] = [
  exampleRow(22, { ticket: '064' }),
  exampleRow(20, { ticket: '065' }),
  exampleRow(16, { ticket: '066' }),
  exampleRow(17, { ticket: '067' }),
];

describe('the placeholder board, rebuilt', () => {
  test('finds each placeholder piece it compares against', () => {
    expect(placeholderLane('todo')).toStartWith('<section');
    for (const ticketId of ['061', '059', '055']) {
      expect(placeholderCard(ticketId)).toEndWith('</article>');
    }
  });

  test('matches the To do lane: dividers, the held and waiting marks, the rowless low tickets and the head counts', () => {
    expect(kanbanLaneMarkup('todo', boardInput(TODO_TICKETS, TODO_ROWS))).toBe(placeholderLane('todo'));
  });

  test('matches the paused card #061', () => {
    const ticket = exampleTicket('061', {
      title:   'Delivery ETA on product page',
      status:  'in-progress',
      filed:   at('08:55'),
      started: at('10:20'),
      task:    12,
    });
    const row    = exampleRow(12, {
      status:  'paused',
      ticket:  '061',
      tokens:  900_000,
      start:   at('10:20'),
      history: [{ status: 'pending', at: at('08:55') }, { status: 'in-progress', at: at('10:20') }, { status: 'paused', at: at('11:45') }],
    });
    const input  = boardInput([ticket], [row]);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'progress', kanbanCardFormatOf(input))).toBe(placeholderCard('061'));
  });

  test('matches the second-round review card #059', () => {
    const ticket = exampleTicket('059', {
      title:    'Accent-blind search',
      type:     'bug',
      status:   'in-review',
      filed:    at('08:40'),
      started:  at('09:15'),
      finished: at('10:48'),
      task:     9,
    });
    const tasks = [
      exampleRow(9, {
        status:      're-review',
        ticket:      '059',
        tokens:      4_200_000,
        reviewRound: 2,
      }),
      exampleRow(30, {
        reviewOf: '059',
        status:   'delivered',
        start:    at('10:50'),
        end:      at('11:30'),
      }),
      exampleRow(31, { reviewOf: '059', status: 'in-progress', start: at('11:34') }),
    ];
    const input  = boardInput([ticket], tasks);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'review', kanbanCardFormatOf(input))).toBe(placeholderCard('059'));
  });

  test('matches the reviewed Done card #055', () => {
    const ticket = exampleTicket('055', {
      title:     'Gift card ignored at checkout',
      type:      'bug',
      priority:  'high',
      status:    'delivered',
      filed:     at('09:04'),
      started:   at('09:15'),
      finished:  at('10:48'),
      delivered: at('13:28'),
      task:      7,
    });
    const row    = exampleRow(7, {
      status:   'delivered',
      ticket:   '055',
      tokens:   2_400_000,
      reviewed: at('12:10'),
    });
    const input  = boardInput([ticket], [row]);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'done', kanbanCardFormatOf(input))).toBe(placeholderCard('055'));
  });

  test('matches the Done footer of 18 tickets capped at 15', () => {
    const { tickets, tasks } = deliveredTickets(PLACEHOLDER_DONE_LANE_COUNT);
    const footer             = /<div class="ap-lane-more">[\s\S]*?<\/div><\/div>/.exec(placeholderLane('done'))?.[0] ?? 'the placeholder has no footer';

    expect(kanbanLaneMarkup('done', boardInput(tickets, tasks))).toEndWith(`${footer}</section>`);
  });
});

describe('the capped lanes', () => {
  const LANE_COUNT = 52;

  test('offer 25 more, then the remaining 12 beside Latest 15, then only Latest 15', () => {
    const second = shownCountAfterMore(15, LANE_COUNT);
    const third  = shownCountAfterMore(second, LANE_COUNT);

    expect(cappedLaneFooterMarkup('done', 15, LANE_COUNT)).toBe(
      '<div class="ap-lane-more"><span>15 of 52 shown</span><div class="ap-seg"><button type="button" data-lane-more="done">Show 25 more</button></div></div>',
    );
    expect(cappedLaneFooterMarkup('done', second, LANE_COUNT)).toBe([
      '<div class="ap-lane-more"><span>40 of 52 shown</span><div class="ap-seg"><button type="button" data-lane-more="done">Show 12 more</button>',
      '<button type="button" data-lane-reset="done">Latest 15</button></div></div>',
    ].join(''));
    expect(cappedLaneFooterMarkup('done', third, LANE_COUNT)).toBe(
      '<div class="ap-lane-more"><span>52 of 52 shown</span><div class="ap-seg"><button type="button" data-lane-reset="done">Latest 15</button></div></div>',
    );
  });

  test('ends with what the switch hides and a show-all link, after the paging', () => {
    expect(cappedLaneFooterMarkup('abandoned', 15, 3, 19)).toBe([
      '<div class="ap-lane-more"><div class="ap-lane-hidden-line"><span>19 earlier hidden</span>',
      '<button type="button" class="ap-link-button" data-show-all-finished>show all</button></div></div>',
    ].join(''));
    expect(cappedLaneFooterMarkup('done', 15, LANE_COUNT, 2)).toContain('Show 25 more</button></div><div class="ap-lane-hidden-line"><span>2 earlier hidden</span>');
  });

  test('shows no footer on a lane of 15 or fewer', () => {
    expect(cappedLaneFooterMarkup('abandoned', cappedLaneShownCount(40, 15), 15)).toBe('');
  });

  test('renders as many cards as the clamped count', () => {
    const { tickets, tasks } = deliveredTickets(LANE_COUNT);
    const lane               = kanbanLaneMarkup('done', boardInput(tickets, tasks, { shownCountByClosedLane: { done: 40, abandoned: 15 } }));

    expect(lane.split('<article ').length - 1).toBe(40);
    expect(lane).toContain('<span class="ap-lane-count">52</span>');
  });
});

describe('the empty lanes', () => {
  test('say how far back the finished-work switch reaches, and nothing of it under all', () => {
    const lastDay = kanbanBoardMarkup(boardInput([], []));
    const since   = kanbanBoardMarkup(boardInput([], [], { finishedWork: 'since-2026-09-24' }));
    const all     = kanbanBoardMarkup(boardInput([], [], { finishedWork: 'all' }));

    expect(lastDay).toContain('<div class="ap-empty">Nothing done in the last day.</div>');
    expect(lastDay).toContain('<div class="ap-empty">Nothing abandoned in the last day.</div>');
    expect(since).toContain('<div class="ap-empty">Nothing done since 09-24.</div>');
    expect(all).toContain('<div class="ap-empty">Nothing done yet.</div>');
    expect(all).toContain('<div class="ap-empty">Nothing abandoned.</div>');
    expect(all).toContain('<div class="ap-empty">Nothing waiting to start.</div>');
  });
});

describe('the Abandoned lane', () => {
  test('is a collapsed strip whose head is one toggle until opened', () => {
    const closed = kanbanLaneMarkup('abandoned', boardInput([], []));
    const open   = kanbanLaneMarkup('abandoned', boardInput([], [], { abandonedLaneIsOpen: true }));

    expect(closed).toStartWith('<section class="ap-card ap-lane" data-lane="abandoned" data-collapsed="" aria-label="Abandoned">');
    expect(closed).toContain('<button type="button" class="ap-lane-toggle" aria-expanded="false" aria-controls="ap-lane-abandoned-cards" title="Show the abandoned tickets">');
    expect(open).not.toContain('data-collapsed');
    expect(open).toContain('aria-expanded="true"');
  });

  test('matches the placeholder lane’s head', () => {
    const ticket = exampleTicket('046', {
      title:       'Replace the home carousel',
      type:        'ticket',
      status:      'abandoned',
      filed:       at('18:20', '2026-09-24'),
      abandonedAt: at('09:40'),
      reason:      'Superseded by #056',
      task:        6,
    });

    expect(kanbanLaneMarkup('abandoned', boardInput([ticket], [exampleRow(6, { status: 'abandoned', ticket: '046' })]))).toBe(placeholderLane('abandoned'));
  });
});

function laneHeadOf(markup: string): string {
  return /<div class="ap-card-head"[^>]*>/.exec(markup)?.[0] ?? '';
}

describe('the lane heads', () => {
  test('render no subtitle in any lane', () => {
    expect(kanbanBoardMarkup(boardInput(TODO_TICKETS, TODO_ROWS))).not.toContain('ap-lane-sub');
  });

  test('To do carries its waiting, held and rowless counts as the hover, zero counts dropped', () => {
    const tickets = [exampleTicket('001', { dependsOn: ['002'] }), exampleTicket('002')];
    expect(laneHeadOf(kanbanLaneMarkup('todo', boardInput(tickets, [])))).toBe('<div class="ap-card-head" data-state="pending" title="1 waiting · 2 no row">');
  });

  test('To do with nothing to count has no hover', () => {
    expect(laneHeadOf(kanbanLaneMarkup('todo', boardInput([], [])))).toBe('<div class="ap-card-head" data-state="pending">');
  });

  test('In progress carries its working and paused counts with plain dots as the hover', () => {
    const tickets = [exampleTicket('001', { status: 'in-progress', task: 1 }), exampleTicket('002', { status: 'in-progress', task: 2 })];
    const rows    = [exampleRow(1, { status: 'in-progress', ticket: '001' }), exampleRow(2, { status: 'paused', ticket: '002' })];
    expect(laneHeadOf(kanbanLaneMarkup('progress', boardInput(tickets, rows)))).toBe('<div class="ap-card-head" data-state="in-progress" title="• 1 in progress · ○ 1 paused">');
  });

  test('In progress with no cards has no hover', () => {
    expect(laneHeadOf(kanbanLaneMarkup('progress', boardInput([], [])))).toBe('<div class="ap-card-head" data-state="in-progress">');
  });

  test('Review carries its awaiting and reviewing counts with plain dots as the hover', () => {
    const tickets = [exampleTicket('001', { status: 'in-review' })];
    expect(laneHeadOf(kanbanLaneMarkup('review', boardInput(tickets, []))))
      .toBe('<div class="ap-card-head" data-state="reviewing" title="○ 1 awaiting review">');
  });

  test('Awaiting merge carries "by priority" as the hover', () => {
    expect(laneHeadOf(kanbanLaneMarkup('merge', boardInput([], [])))).toBe('<div class="ap-card-head" data-state="reviewed" title="by priority">');
  });

  test('Done carries "newest first" and its reviewed-first count as the hover', () => {
    const ticket = exampleTicket('055', { status: 'delivered', delivered: at('13:28'), task: 7 });
    const row    = exampleRow(7, { status: 'delivered', ticket: '055', reviewed: at('12:10') });
    expect(laneHeadOf(kanbanLaneMarkup('done', boardInput([ticket], [row])))).toBe('<div class="ap-card-head" data-state="delivered" title="newest first · ✓1 reviewed first">');
  });

  test('Abandoned carries "newest first" as the hover beside its toggle', () => {
    expect(laneHeadOf(kanbanLaneMarkup('abandoned', boardInput([], [])))).toBe('<div class="ap-card-head" data-state="abandoned" title="newest first">');
  });
});

describe('a card’s marks', () => {
  test('says Held without a colon when no reason was given', () => {
    const input  = boardInput([exampleTicket('070', { hold: '' })], []);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'todo', kanbanCardFormatOf(input))).toContain('<span class="ap-kanban-held" title="Held">held</span>');
  });

  test('escapes a title, a reason and a hold carrying markup', () => {
    const input = boardInput([
      exampleTicket('071', { title: '<b>bold</b>', hold: '<i>x</i>' }),
      exampleTicket('072', { status: 'abandoned', reason: '<script>alert(1)</script>' }),
    ], []);
    const board = kanbanBoardMarkup({ ...input, abandonedLaneIsOpen: true });

    expect(board).not.toContain('<b>');
    expect(board).not.toContain('<i>');
    expect(board).not.toContain('<script>');
    expect(board).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

/**
 * #001 and #002 start now; #003 waits on #001, and #005 to #007 on #002, side by side in wave 2; #004 waits on #003 alone in wave 3, the
 * narrow one. The pace path runs #001, #003, #004, so #001 leads its wave although #002 holds more.
 */
const WAVE_TICKETS: PageTicket[] = [
  exampleTicket('001'),
  exampleTicket('002'),
  exampleTicket('003', { dependsOn: ['001'] }),
  exampleTicket('004', { dependsOn: ['003'] }),
  exampleTicket('005', { dependsOn: ['002'] }),
  exampleTicket('006', { dependsOn: ['002'] }),
  exampleTicket('007', { dependsOn: ['002'] }),
];

function ticketIdsInOrder(markup: string): string[] {
  return [...markup.matchAll(/data-ticket-id="(\d+)"/g)].map((match) => match[1] ?? '');
}

function waveGroupsOf(markup: string): string[] {
  return [...markup.matchAll(/<div class="ap-lane-wave"[^>]*><div class="ap-lane-group">[^<]*<span class="ap-lane-group-note">[^<]*<\/span>/g)].map((match) => match[0]);
}

describe('the To do order', () => {
  test('filed keeps the filed lane: no wave groups, the usual sub-line', () => {
    const lane = kanbanLaneMarkup('todo', boardInput(WAVE_TICKETS, []));

    expect(lane).not.toContain('ap-lane-wave');
    expect(lane).not.toContain('ready ·');
  });

  test('by wave groups To do by wave, names them, notes their width and tints only the narrow one', () => {
    const lane = kanbanLaneMarkup('todo', boardInput(WAVE_TICKETS, [], { todoOrder: 'by-wave' }));

    expect(waveGroupsOf(lane)).toEqual([
      '<div class="ap-lane-wave" data-wave="0"><div class="ap-lane-group">Now <span class="ap-lane-group-note">2 ready · 2 side by side</span>',
      '<div class="ap-lane-wave" data-wave="1"><div class="ap-lane-group">Wave 2 <span class="ap-lane-group-note">4 side by side</span>',
      '<div class="ap-lane-wave" data-wave="2" data-narrow=""><div class="ap-lane-group">Wave 3 <span class="ap-lane-group-note">one at a time</span>',
    ]);
    expect(laneHeadOf(lane)).toBe('<div class="ap-card-head" data-state="pending" title="2 ready · 5 waiting">');
    expect(lane).not.toContain('data-priority');
  });

  test('by wave counts as ready only what the Board lists ready and not held: a held ticket stays in Now, waiting', () => {
    const tickets = [...WAVE_TICKETS, exampleTicket('008', { hold: 'not before 2026-10-05' })];
    const input   = boardInput(tickets, [], { todoOrder: 'by-wave' });
    const lane    = kanbanLaneMarkup('todo', input);

    expect([...input.readyTicketIds].sort()).toEqual(['001', '002']);
    expect(waveGroupsOf(lane)[0]).toBe(
      '<div class="ap-lane-wave" data-wave="0"><div class="ap-lane-group">Now <span class="ap-lane-group-note">2 ready · 3 side by side</span>'
    );
    expect(laneHeadOf(lane)).toBe('<div class="ap-card-head" data-state="pending" title="2 ready · 6 waiting">');
  });

  test('by wave gives a pending low ticket no wave group: it closes the lane, and Now neither holds nor counts it', () => {
    const tickets = [...WAVE_TICKETS, exampleTicket('009', { priority: 'low' })];
    const lane    = kanbanLaneMarkup('todo', boardInput(tickets, [], { todoOrder: 'by-wave' }));

    expect(waveGroupsOf(lane)[0]).toBe(
      '<div class="ap-lane-wave" data-wave="0"><div class="ap-lane-group">Now <span class="ap-lane-group-note">2 ready · 2 side by side</span>'
    );
    expect(ticketIdsInOrder(lane).at(-1)).toBe('009');
    expect(lane.slice(lane.lastIndexOf('class="ap-lane-wave"'), lane.indexOf('data-ticket-id="009"'))).toContain('</article></div><article');
  });

  test('by wave puts the pace-path ticket first in its group, then the most held', () => {
    const lane = kanbanLaneMarkup('todo', boardInput(WAVE_TICKETS, [], { todoOrder: 'by-wave' }));

    expect(ticketIdsInOrder(lane)).toEqual(['001', '002', '003', '005', '006', '007', '004']);
  });

  test('by wave leaves the other lanes as they are', () => {
    const tickets = [...WAVE_TICKETS, exampleTicket('008', { status: 'in-progress' })];

    expect(kanbanLaneMarkup('progress', boardInput(tickets, [], { todoOrder: 'by-wave' }))).toBe(kanbanLaneMarkup('progress', boardInput(tickets, [])));
  });
});

describe('a card’s dependency head', () => {
  function cardMarkupOf(ticketId: string, lane: 'todo' | 'done', tickets: readonly PageTicket[], todoOrder: 'filed' | 'by-wave' = 'filed'): string {
    const input = boardInput(tickets, [], { todoOrder });
    const card  = input.cards.find((candidate) => candidate.ticket.id === ticketId);
    return card === undefined ? '' : kanbanCardMarkup(card, lane, kanbanCardFormatOf(input));
  }

  test('holds the "needed first" slot, hidden until hovered, on a card another depends on, in both orders', () => {
    for (const todoOrder of ['filed', 'by-wave'] as const) {
      expect(cardMarkupOf('003', 'todo', WAVE_TICKETS, todoOrder)).toContain('<span class="ap-kanban-needed-first" aria-hidden="true">needed first</span>');
      expect(cardMarkupOf('004', 'todo', WAVE_TICKETS, todoOrder)).not.toContain('needed first');
    }
  });

  test('counts every ticket waiting on the card, down the whole chain, as ↦ N, and none on a card nothing waits on', () => {
    expect(cardMarkupOf('001', 'todo', WAVE_TICKETS)).toContain('title="2 tickets wait on this one, directly or further down the chain">↦ 2</span>');
    expect(cardMarkupOf('003', 'todo', WAVE_TICKETS)).toContain('title="1 ticket waits on this one, directly or further down the chain">↦ 1</span>');
    expect(cardMarkupOf('004', 'todo', WAVE_TICKETS)).not.toContain('↦');
  });

  test('sets ↦ N in full ink from five', () => {
    const tickets = [...WAVE_TICKETS, exampleTicket('008', { dependsOn: ['002'] }), exampleTicket('009', { dependsOn: ['002'] })];

    expect(cardMarkupOf('002', 'todo', WAVE_TICKETS)).toContain('<span class="ap-kanban-held-count" title=');
    expect(cardMarkupOf('002', 'todo', tickets)).toContain('<span class="ap-kanban-held-count" data-heavy="" title=');
  });

  test('shows no ↦ N on a finished card', () => {
    const tickets = [exampleTicket('001', { status: 'delivered', delivered: at('12:00') }), exampleTicket('002', { dependsOn: ['001'] })];

    expect(cardMarkupOf('001', 'done', tickets)).not.toContain('↦');
  });

  test('ends the head with ↦ N and the token count together, so a crowded head wraps them as one and never runs them under the rest', () => {
    const tickets = [exampleTicket('001', { task: 1 }), exampleTicket('002', { dependsOn: ['001'] })];
    const input   = boardInput(tickets, [exampleRow(1, { ticket: '001', tokens: 1_800_000 })]);
    const card    = input.cards.find((candidate) => candidate.ticket.id === '001');
    const markup  = card === undefined ? '' : kanbanCardMarkup(card, 'todo', kanbanCardFormatOf(input));

    expect(markup).toContain('<span class="ap-kanban-head-end"><span class="ap-kanban-held-count" '
      + 'title="1 ticket waits on this one, directly or further down the chain">↦ 1</span><span class="ap-tokens">1.8M tokens</span></span></div>');
  });

  test('keeps the head of a card on a board without dependencies as it was', () => {
    expect(cardMarkupOf('001', 'todo', [exampleTicket('001')])).toContain('<span class="ap-detail-type" data-type="ticket">ticket</span></div>');
  });
});
