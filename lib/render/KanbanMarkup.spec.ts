/**
 * The Kanban markup against the template's placeholder board, which is the contract: the To do lane, three cards and the Done footer are
 * rebuilt from constructed inputs and must match the template's text exactly. Then the parts the placeholder does not show: the cap's
 * buttons, the empty lanes under Show all, the Abandoned toggle and the escaping.
 */

import { describe, expect, test }                                    from 'bun:test';
import type { Task }                                                 from '../constants/Types.ts';
import { cappedLaneShownCount, kanbanCardsFor, shownCountAfterMore } from './page/KanbanBoard.ts';
import type { KanbanBoardInput }                                     from './page/KanbanMarkup.ts';
import {
  cappedLaneFooterMarkup,
  kanbanBoardMarkup,
  kanbanCardMarkup,
  kanbanLaneMarkup,
} from './page/KanbanMarkup.ts';
import type { PageTicket } from './page/PageData.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_SLICES = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

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
    type:        'feature',
    status:      'open',
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
  return {
    cards:                  kanbanCardsFor(tickets, tasks, waitingOnById),
    tasks,
    nowEpochMilliseconds:   EXAMPLE_NOW,
    todayCalendarDate:      EXAMPLE_TODAY,
    slices:                 EXAMPLE_SLICES,
    showsAllWork:           false,
    shownCountByClosedLane: { done: 15, abandoned: 15 },
    abandonedLaneIsOpen:    false,
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

const templateText = await Bun.file(`${import.meta.dir}/page/template.html`).text();

function placeholderLane(lane: string): string {
  return templateText.split('\n').find((line) => line.includes(`<section class="ap-card ap-lane" data-lane="${lane}"`))?.trim() ?? '';
}

function placeholderCard(ticketId: string): string {
  return new RegExp(`<article class="ap-kanban-card" id="ap-kanban-${ticketId}"[\\s\\S]*?</article>`).exec(templateText)?.[0] ?? '';
}

const TODO_TICKETS: PageTicket[] = [
  exampleTicket('064', {
    title: 'Checkout button double-submits on a slow network', type: 'bug', priority: 'high', filed: at('13:02'), task: 22 
  }),
  exampleTicket('065', {
    title: 'Wishlist share link', filed: at('11:20'), task: 20, dependsOn: ['060'] 
  }),
  exampleTicket('066', {
    title: 'Rename basket to cart in order e-mails', type: 'change', filed: at('09:50'), task: 16, hold: 'Waiting for copy from marketing' 
  }),
  exampleTicket('067', { title: 'Sort orders by delivery date', filed: at('10:12'), task: 17 }),
  exampleTicket('068', {
    title: 'Footer links wrap on tablets', type: 'bug', priority: 'low', filed: at('17:40', '2026-09-24') 
  }),
  exampleTicket('069', {
    title: 'Admin table column widths jump on sort', type: 'bug', priority: 'low', filed: at('12:05') 
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
      title: 'Delivery ETA on product page', status: 'in-progress', filed: at('08:55'), started: at('10:20'), task: 12 
    });
    const row    = exampleRow(12, {
      status:  'paused',
      ticket:  '061',
      tokens:  900_000,
      start:   at('10:20'),
      history: [{ status: 'pending', at: at('08:55') }, { status: 'running', at: at('10:20') }, { status: 'paused', at: at('11:45') }],
    });
    const input  = boardInput([ticket], [row]);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'progress', input)).toBe(placeholderCard('061'));
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
        status: 're-review', ticket: '059', tokens: 4_200_000, reviewRound: 2 
      }),
      exampleRow(30, {
        reviewOf: '059', status: 'delivered', start: at('10:50'), end: at('11:30') 
      }),
      exampleRow(31, { reviewOf: '059', status: 'running', start: at('11:34') }),
    ];
    const input  = boardInput([ticket], tasks);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'review', input)).toBe(placeholderCard('059'));
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
      status: 'delivered', ticket: '055', tokens: 2_400_000, reviewed: at('12:10') 
    });
    const input  = boardInput([ticket], [row]);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'done', input)).toBe(placeholderCard('055'));
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
  test('say "in the last day" under Hide and not under Show all', () => {
    const hidden = kanbanBoardMarkup(boardInput([], []));
    const all    = kanbanBoardMarkup(boardInput([], [], { showsAllWork: true }));

    expect(hidden).toContain('<div class="ap-empty">Nothing delivered in the last day.</div>');
    expect(hidden).toContain('<div class="ap-empty">Nothing abandoned in the last day.</div>');
    expect(all).toContain('<div class="ap-empty">Nothing delivered yet.</div>');
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
      type:        'change',
      status:      'abandoned',
      filed:       at('18:20', '2026-09-24'),
      abandonedAt: at('09:40'),
      reason:      'Superseded by #056',
      task:        6,
    });

    expect(kanbanLaneMarkup('abandoned', boardInput([ticket], [exampleRow(6, { status: 'abandoned', ticket: '046' })]))).toBe(placeholderLane('abandoned'));
  });
});

describe('a card’s marks', () => {
  test('says Held without a colon when no reason was given', () => {
    const input  = boardInput([exampleTicket('070', { hold: '' })], []);
    const [card] = input.cards;

    expect(card === undefined ? '' : kanbanCardMarkup(card, 'todo', input)).toContain('<span class="ap-kanban-held" title="Held">held</span>');
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
