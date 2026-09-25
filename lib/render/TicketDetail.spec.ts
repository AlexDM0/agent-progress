/**
 * The body a Kanban card's dialog shows. What callers rely on is the order — head, facts, Timeline, Description — the facts present
 * and only those, in their fixed order, the waiting-on links leading to Kanban cards, and the quiet filed bar existing only here: the
 * Progress chart, the Kanban board and a row's overview never draw it.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../constants/Types.ts';
import { kanbanCardsFor }         from './page/KanbanBoard.ts';
import type { KanbanCard }        from './page/KanbanBoard.ts';
import { kanbanBoardMarkup }      from './page/KanbanMarkup.ts';
import type { PageTicket }        from './page/PageData.ts';
import { taskRowsMarkup }         from './page/PageMarkup.ts';
import { taskDetailMarkup }       from './page/TaskDetail.ts';
import type { TicketDetailInput } from './page/TicketDetail.ts';
import { ticketDetailMarkup }     from './page/TicketDetail.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_LIMITS = {
  tickStepLadderMinutes:      [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440],
  maximumTicksPerAxis:        12,
  axisMinimumSpanMinutes:     60,
  axisPaddingMinutes:         15,
  minimumBarWidthPercent:     0.6,
  hoursAxisLabelLimitMinutes: 1440,
  weekAxisLabelLimitMinutes:  10_080,
  hourMinutes:                60,
  dayMinutes:                 1440,
  tickCountSafetyBound:       500,
  dateAndClockLength:         16,
  calendarDateLength:         10,
  monthAndDaySliceStart:      5,
  clockSliceStart:            11,
  clockSliceEnd:              16,
};

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'bug',
    status:      'open',
    filed:       at('08:40'),
    updated:     at('08:40'),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '<p>Example description.</p>',
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

const DELIVERED_TICKET = exampleTicket('055', {
  status:    'delivered',
  priority:  'high',
  branch:    'ticket-055',
  started:   at('09:15'),
  finished:  at('10:48'),
  delivered: at('13:28'),
  updated:   at('13:28'),
  task:      7,
});

const DELIVERED_ROW = exampleRow(7, {
  ticket:   '055',
  status:   'delivered',
  start:    at('09:15'),
  end:      at('10:48'),
  reviewed: at('12:10'),
});

const WAITING_TICKET = exampleTicket('065', { title: 'Wishlist <share> link', task: 20, dependsOn: ['060'] });

const WAITING_ROW = exampleRow(20, { ticket: '065' });

const TASKS = [DELIVERED_ROW, WAITING_ROW];

function cardFor(ticket: PageTicket, waitingOn: readonly string[] = []): KanbanCard {
  const card = kanbanCardsFor([ticket], TASKS, new Map([[ticket.id, waitingOn]]))[0];
  if (card === undefined) {
    throw new Error('the example card was not built');
  }
  return card;
}

function inputFor(card: KanbanCard): TicketDetailInput {
  return {
    card,
    tasks:                TASKS,
    nowEpochMilliseconds: EXAMPLE_NOW,
    todayCalendarDate:    EXAMPLE_TODAY,
    limits:               EXAMPLE_LIMITS,
  };
}

function factLabelsOf(markup: string): string[] {
  const facts = /<div class="ap-ticket-meta">(.*?)<\/div><section/.exec(markup)?.[1] ?? '';
  return [...facts.matchAll(/<b>([^<]+)<\/b>/g)].map((match) => match[1] ?? '');
}

describe('the ticket body', () => {
  const delivered = ticketDetailMarkup(inputFor(cardFor(DELIVERED_TICKET)));

  test('runs head, facts, Timeline, then Description', () => {
    const order = ['class="ap-detail-head"', 'class="ap-ticket-meta"', '>Timeline</h3>', '>Description</h3>'].map((marker) => delivered.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(delivered).toContain('<div class="ap-ticket-body md"><p>Example description.</p></div></section>');
  });

  test('its head carries the card’s state, the pill, the ✓ of a ticket reviewed before delivery, the priority mark and the type', () => {
    const head = delivered.slice(0, delivered.indexOf('<div class="ap-ticket-meta">'));
    expect(head.startsWith('<div class="ap-detail-head" data-state="delivered"><span class="ap-detail-id">#055</span>')).toBe(true);
    expect(head).toMatch(/<h2 class="ap-detail-title">Example ticket 055<\/h2><span class="ap-pill">done<\/span><span class="ap-reviewed-mark"[^>]*>✓<\/span>/);
    expect(head).toMatch(/<span class="ap-waiting" data-priority="high"[^>]*>high<\/span><span class="ap-detail-type">bug<\/span><\/div>$/);
  });

  test('its facts are the present ones in their fixed order, the reviewed stamp read off the own row', () => {
    expect(factLabelsOf(delivered)).toEqual(['filed', 'started', 'finished', 'reviewed', 'delivered', 'branch', 'task']);
    expect(delivered).toContain('<div><b>reviewed</b><span title="2026-09-25 12:10">12:10</span></div>');
    expect(delivered).toContain('<div><b>task</b><span><a href="#ap-task-7">#7</a></span></div>');
  });

  test('a waiting ticket links what it waits on to its Kanban card, has no ✓, and escapes its title', () => {
    const waiting = ticketDetailMarkup(inputFor(cardFor(WAITING_TICKET, ['060'])));
    expect(factLabelsOf(waiting)).toEqual(['filed', 'waiting on', 'task']);
    expect(waiting).toContain('<div><b>waiting on</b><span><a href="#ap-kanban-060" data-ticket-link="060">#060</a></span></div>');
    expect(waiting).not.toContain('ap-reviewed-mark');
    expect(waiting).toContain('Wishlist &lt;share&gt; link');
    expect(waiting).toContain('<p class="ap-ticket-gantt-note">Not started: in the queue for 4h 56m. Waiting on #060.</p>');
  });

  test('a held ticket names its reason among the facts, or says none was given', () => {
    expect(ticketDetailMarkup(inputFor(cardFor({ ...WAITING_TICKET, hold: 'Example Agency copy' })))).toContain('<div><b>held</b><span>Example Agency copy</span></div>');
    expect(ticketDetailMarkup(inputFor(cardFor({ ...WAITING_TICKET, hold: '' })))).toContain('<div><b>held</b><span>no reason given</span></div>');
  });
});

// The quiet filed bar is the dialog's alone: drawing it on the Progress chart would put a ticket's queue time among the rows' work.
describe('the filed bar outside the dialog', () => {
  test('neither the Progress rows, the Kanban board nor a row’s overview draws one', () => {
    const bar     = {
      leftPercent:  0,
      widthPercent: 10,
      clippedLeft:  false,
      clippedRight: false,
      visible:      true,
    };
    const rows    = taskRowsMarkup(TASKS.map((task) => ({
      task,
      ticketStatus: null,
      bar:          { ...bar, taskId: task.id },
      waitingOn:    [],
    })), EXAMPLE_LIMITS);
    const board   = kanbanBoardMarkup({
      cards:                  [cardFor(DELIVERED_TICKET), cardFor(WAITING_TICKET)],
      tasks:                  TASKS,
      nowEpochMilliseconds:   EXAMPLE_NOW,
      todayCalendarDate:      EXAMPLE_TODAY,
      slices:                 EXAMPLE_LIMITS,
      showsAllWork:           true,
      shownCountByClosedLane: { done: 15, abandoned: 15 },
      abandonedLaneIsOpen:    true,
    });
    const overview = taskDetailMarkup({
      task:              DELIVERED_ROW,
      ticket:            DELIVERED_TICKET,
      log:               [],
      slices:            EXAMPLE_LIMITS,
      todayCalendarDate: EXAMPLE_TODAY,
    });
    expect(rows).toContain('ap-row');
    expect(board).toContain('ap-kanban-card');
    for (const markup of [rows, board, overview]) {
      expect(markup).not.toContain('ap-ticket-gantt');
    }
    expect(ticketDetailMarkup(inputFor(cardFor(DELIVERED_TICKET)))).toContain('class="ap-bar ap-ticket-gantt-filed"');
  });
});
