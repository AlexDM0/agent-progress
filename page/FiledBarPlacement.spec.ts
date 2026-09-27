/**
 * The quiet filed bar is the ticket dialog's alone: the Progress rows, the Kanban board and a row's overview never draw it, since on
 * the chart it would put a ticket's queue time among the rows' work.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }        from '../src/shared/@types/PagePayload.ts';
import type { KanbanCard }        from './@types/KanbanCard.ts';
import { taskDetailMarkup }       from './detail-dialog/TaskDetail.ts';
import type { TicketDetailInput } from './detail-dialog/TicketDetail.ts';
import { ticketDetailMarkup }     from './detail-dialog/TicketDetail.ts';
import { kanbanBoardMarkup }      from './kanban/KanbanMarkup.ts';
import { KanbanLaneUtil }         from './kanban/utils/KanbanLaneUtil.ts';
import { taskRowsMarkup }         from './progress/ProgressMarkup.ts';
import { pageBoardFixture }       from './testing/PageBoardFixture.ts';

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
    status:      'pending',
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
  const card = KanbanLaneUtil.kanbanCardsFor(pageBoardFixture({ tasks: TASKS, tickets: [ticket] }).tickets, new Map([[ticket.id, waitingOn]]))[0];
  if (card === undefined) {
    throw new Error('the example card was not built');
  }
  return card;
}

function inputFor(card: KanbanCard): TicketDetailInput {
  return {
    card,
    nowEpochMilliseconds: EXAMPLE_NOW,
    todayCalendarDate:    EXAMPLE_TODAY,
    limits:               EXAMPLE_LIMITS,
  };
}

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
    const boardRows = pageBoardFixture({ tasks: TASKS, tickets: [DELIVERED_TICKET, WAITING_TICKET] }).rows;
    const rows      = taskRowsMarkup(boardRows.map((task) => ({
      task,
      bar:       { ...bar, taskId: task.id },
      waitingOn: [],
    })), EXAMPLE_LIMITS);
    const board   = kanbanBoardMarkup({
      cards:                  [cardFor(DELIVERED_TICKET), cardFor(WAITING_TICKET)],
      nowEpochMilliseconds:   EXAMPLE_NOW,
      todayCalendarDate:      EXAMPLE_TODAY,
      slices:                 EXAMPLE_LIMITS,
      showsAllWork:           true,
      shownCountByClosedLane: { done: 15, abandoned: 15 },
      abandonedLaneIsOpen:    true,
    });
    const overview = taskDetailMarkup({
      task:              boardRows.find((row) => row.id === DELIVERED_ROW.id) ?? null,
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
