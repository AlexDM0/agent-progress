/**
 * One fixture board drawn whole by `page/kanban/KanbanMarkup.ts` under each view the viewer can choose: every lane, To do by priority and
 * by wave, Abandoned closed and open, the Done paging footer with its hidden line, and the empty lanes. `KanbanMarkup.frozen.spec.ts`
 * compares it against `page/testing/FrozenKanbanBoards.json`. Test-only: nothing that ships may import `page/testing/`.
 */
import type { EpicFrontmatter }  from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }             from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }       from '../../src/shared/@types/PagePayload.ts';
import type { KanbanBoardInput } from '../kanban/@types/KanbanBoardInput.ts';
import { kanbanBoardMarkup }     from '../kanban/KanbanMarkup.ts';
import { KanbanLaneUtil }        from '../kanban/utils/KanbanLaneUtil.ts';
import { DependencyGraphUtil }   from '../utils/DependencyGraphUtil.ts';
import { pageBoardFixture }      from './PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }   from './PageLimitsFixture.ts';

const EXAMPLE_TODAY       = '2026-09-25';
const EXAMPLE_NOW         = Date.parse('2026-09-25T13:36:00+02:00');
const EXAMPLE_BOARD_SLOTS = 5;
const DELIVERED_COUNT     = 18;
const FIRST_DELIVERED_ID  = 100;
const FIRST_DELIVERED_ROW = 100;

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

const EPICS: EpicFrontmatter[] = [
  {
    key: 'checkout', title: 'Checkout <flow>', slot: 1, extra: []
  },
  {
    key: 'emails', title: 'Order emails', slot: 2, extra: []
  },
  {
    key: 'search', title: 'Search', slot: 3, extra: []
  },
];

const OPEN_TICKETS: PageTicket[] = [
  exampleTicket('001', {
    title: 'Payment step', priority: 'high', status: 'in-progress', started: at('09:00'), task: 1, epics: ['checkout', 'emails', 'search']
  }),
  exampleTicket('002', {
    title: 'Address form', status: 'pending', task: 2, dependsOn: ['001'], epics: ['checkout'], filed: at('09:10')
  }),
  exampleTicket('003', {
    title: 'Receipt "mail" & copy', status: 'pending', task: 3, dependsOn: ['002'], epics: ['emails'], filed: at('09:20')
  }),
  exampleTicket('004', {
    title: 'Side task', status: 'pending', task: 4, filed: at('09:30')
  }),
  exampleTicket('005', {
    title: 'Footer wrap', type: 'bug', priority: 'low', status: 'pending', filed: at('17:40', '2026-09-24')
  }),
  exampleTicket('006', {
    title: 'Held work', status: 'pending', task: 6, hold: 'Waiting for copy', dependsOn: ['001']
  }),
  exampleTicket('007', {
    title: 'Paused build', status: 'in-progress', started: at('10:20'), task: 7
  }),
  exampleTicket('008', {
    title: 'Under review', type: 'bug', status: 'in-review', started: at('09:15'), finished: at('10:48'), task: 8
  }),
  exampleTicket('009', {
    title: 'Awaiting merge', priority: 'high', status: 'reviewed', started: at('08:15'), finished: at('09:48'), task: 9
  }),
  exampleTicket('010', {
    title: 'Second merge', status: 'reviewed', started: at('08:20'), finished: at('09:50'), task: 10
  }),
  exampleTicket('011', {
    title: 'Dropped idea', status: 'abandoned', abandonedAt: at('11:00'), epics: ['search']
  }),
];

const OPEN_ROWS: Task[] = [
  exampleRow(1, {
    ticket: '001', status: 'in-progress', start: at('09:00'), tokens: 1_200_000
  }),
  exampleRow(2, { ticket: '002' }),
  exampleRow(3, { ticket: '003' }),
  exampleRow(4, { ticket: '004' }),
  exampleRow(6, { ticket: '006' }),
  exampleRow(7, {
    ticket:  '007',
    status:  'paused',
    start:   at('10:20'),
    tokens:  900_000,
    history: [{ status: 'pending', at: at('08:55') }, { status: 'in-progress', at: at('10:20') }, { status: 'paused', at: at('11:45') }],
  }),
  exampleRow(8, {
    ticket: '008', status: 're-review', tokens: 4_200_000, reviewRound: 2
  }),
  exampleRow(30, {
    reviewOf: '008', status: 'delivered', start: at('10:50'), end: at('11:30')
  }),
  exampleRow(31, { reviewOf: '008', status: 'in-progress', start: at('11:34') }),
  exampleRow(9, { ticket: '009', status: 'reviewed' }),
  exampleRow(10, { ticket: '010', status: 'reviewed' }),
];

const DELIVERED_TICKETS: PageTicket[] = Array.from({ length: DELIVERED_COUNT }, (_unused, index) => exampleTicket(String(FIRST_DELIVERED_ID + index), {
  title:     `Delivered work ${index}`,
  status:    'delivered',
  task:      FIRST_DELIVERED_ROW + index,
  delivered: at(`${String(10 + Math.floor(index / 6)).padStart(2, '0')}:${String((index % 6) * 10).padStart(2, '0')}`),
  ...index === 0 ? { epics: ['emails'] } : {},
}));

const DELIVERED_ROWS: Task[] = DELIVERED_TICKETS.map((ticket, index) => exampleRow(FIRST_DELIVERED_ROW + index, {
  ticket: ticket.id,
  status: 'delivered',
  tokens: index === 0 ? 2_400_000 : null,
  ...index === 0 ? { reviewed: at('09:10') } : {},
}));

function boardInputOf(tickets: readonly PageTicket[], tasks: readonly Task[], changes: Partial<KanbanBoardInput> = {}): KanbanBoardInput {
  const waitingOnById = new Map(tickets.flatMap((ticket) => (ticket.dependsOn === undefined ? [] : [[ticket.id, ticket.dependsOn]])));
  const board         = pageBoardFixture({ tasks, tickets, epics: EPICS });
  return {
    cards:                   KanbanLaneUtil.kanbanCardsFor(board.tickets, waitingOnById),
    todoOrder:               'filed',
    dependencyGraph:         DependencyGraphUtil.dependencyGraphOf(board.tickets, EXAMPLE_BOARD_SLOTS),
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

const FULL_TICKETS = [...OPEN_TICKETS, ...DELIVERED_TICKETS];
const FULL_ROWS    = [...OPEN_ROWS, ...DELIVERED_ROWS];

/** Each view's whole board, keyed by what the view shows. */
export function kanbanBoardFrozenCases(): Record<string, string> {
  return {
    'by priority, Abandoned closed, Done on its first page': kanbanBoardMarkup(boardInputOf(FULL_TICKETS, FULL_ROWS)),
    'by wave, Abandoned open':                               kanbanBoardMarkup(boardInputOf(FULL_TICKETS, FULL_ROWS, { todoOrder: 'by-wave', abandonedLaneIsOpen: true })),
    'Done paged to the end with earlier work hidden':        kanbanBoardMarkup(boardInputOf(FULL_TICKETS, FULL_ROWS, {
      shownCountByClosedLane:  { done: DELIVERED_COUNT, abandoned: 15 },
      hiddenCountByClosedLane: { done: 3, abandoned: 2 },
    })),
    'every lane empty, finished work from the last day':  kanbanBoardMarkup(boardInputOf([], [])),
    'every lane empty, all finished work, To do by wave': kanbanBoardMarkup(boardInputOf([], [], { finishedWork: 'all', todoOrder: 'by-wave' })),
  };
}
