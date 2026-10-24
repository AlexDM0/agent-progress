/**
 * Every export of `page/epics/EpicMarkup.ts` over one fixture board of three epics, one settled and one empty, so each mark's every part
 * shows: chips with "+N", the roll-up bar, legend and facts, ticket lists naming other epics, the detail, the cards, the group rows, the
 * filter chips and the strip roll-up. `EpicMarkup.frozen.spec.ts` compares it against `page/testing/FrozenEpicMarks.json`. Test-only:
 * nothing that ships may import `page/testing/`.
 */
import type { EpicFrontmatter } from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }            from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }      from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic }       from '../@types/PageBoard.ts';
import { EpicMarkup }           from '../epics/EpicMarkup.ts';
import { DependencyGraphUtil }  from '../utils/DependencyGraphUtil.ts';
import { pageBoardFixture }     from './PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }  from './PageLimitsFixture.ts';

const BOARD_SLOTS        = 5;
const TABLE_COLUMN_COUNT = 7;

function exampleTicket(id: string, changes: Partial<PageTicket>): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'pending',
    filed:       '2026-09-18T08:00:00+02:00',
    updated:     '2026-09-18T08:00:00+02:00',
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

const EPICS: EpicFrontmatter[] = [
  {
    key: 'checkout', title: 'Checkout <redesign>', slot: 1, extra: []
  },
  {
    key: 'emails', title: 'Order "emails"', slot: 2, extra: []
  },
  {
    key: 'payments', title: 'Payment providers', slot: 3, extra: []
  },
  {
    key: 'empty', title: 'Nothing yet', slot: 4, extra: []
  },
];

const TICKETS: PageTicket[] = [
  exampleTicket('001', {
    title: 'Single-page checkout', status: 'in-progress', started: '2026-09-18T09:00:00+02:00', task: 1, epics: ['checkout', 'emails', 'payments']
  }),
  exampleTicket('002', {
    title: 'Address form', status: 'in-review', started: '2026-09-18T09:10:00+02:00', finished: '2026-09-18T10:00:00+02:00', task: 2, epics: ['checkout'], dependsOn: ['001']
  }),
  exampleTicket('003', {
    title: 'Receipt mail', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00', epics: ['emails']
  }),
  exampleTicket('004', {
    title: 'Dropped mail', status: 'abandoned', abandonedAt: '2026-09-18T12:00:00+02:00', epics: ['emails']
  }),
  exampleTicket('005', {
    title: 'Card provider', status: 'reviewed', task: 5, epics: ['payments', 'checkout']
  }),
  exampleTicket('006', { title: 'No epic at all' }),
];

const ROWS: Task[] = [
  {
    id: 1, name: 'Row 1', status: 'in-progress', start: '2026-09-18T09:00:00+02:00', end: null, owner: 'Alex Example', note: '', ticket: '001', tokens: 1_500_000,
  },
  {
    id: 2, name: 'Row 2', status: 'in-review', start: '2026-09-18T09:10:00+02:00', end: null, owner: 'Alex Example', note: '', ticket: '002', tokens: 300_000,
  },
  {
    id: 5, name: 'Row 5', status: 'reviewed', start: '2026-09-18T08:00:00+02:00', end: '2026-09-18T11:00:00+02:00', owner: 'Alex Example', note: '', ticket: '005', tokens: null,
  },
];

const BOARD        = pageBoardFixture({ tasks: ROWS, tickets: TICKETS, epics: EPICS });
const TICKET_BY_ID = new Map(BOARD.tickets.map((ticket) => [ticket.id, ticket]));
const GRAPH        = DependencyGraphUtil.dependencyGraphOf(BOARD.tickets, BOARD_SLOTS);
const FORMAT       = { limits: EXAMPLE_PAGE_LIMITS, todayCalendarDate: '2026-09-18', nowEpochMilliseconds: Date.parse('2026-09-18T22:00:00+02:00') };

function perEpic<Value>(produce: (epic: BoardEpic) => Value): Record<string, Value> {
  return Object.fromEntries(BOARD.epics.map((epic) => [epic.key, produce(epic)]));
}

/** Each export's output, keyed by the export and then by the epic or the case it was drawn for. */
export function epicMarkFrozenCases(): Record<string, unknown> {
  return {
    epicChipsMarkup: {
      'every epic':     EpicMarkup.epicChipsMarkup(BOARD.epics),
      'limited to two': EpicMarkup.epicChipsMarkup(BOARD.epics, 2),
      'none':           EpicMarkup.epicChipsMarkup([]),
    },
    epicsInShownOrder: EpicMarkup.epicsInShownOrder(BOARD.epics).map((epic) => epic.key),
    epicDetailMarkup:  perEpic((epic) => EpicMarkup.epicDetailMarkup(epic, TICKET_BY_ID, FORMAT)),
    epicCardsMarkup:   EpicMarkup.epicCardsMarkup(BOARD.epics, TICKET_BY_ID, GRAPH, FORMAT),
    epicsTabMarkup:    {
      'every epic shown':              EpicMarkup.epicsTabMarkup(BOARD.epics, TICKET_BY_ID, GRAPH, FORMAT, '1d'),
      'none shown in last three days': EpicMarkup.epicsTabMarkup([], TICKET_BY_ID, GRAPH, FORMAT, '3d'),
    },
    epicGroupRowMarkup: {
      ...perEpic((epic) => EpicMarkup.epicGroupRowMarkup(epic, TABLE_COLUMN_COUNT, FORMAT)),
      'no epic': EpicMarkup.epicGroupRowMarkup(null, TABLE_COLUMN_COUNT, FORMAT),
    },
    epicFilterChipsMarkup:  EpicMarkup.epicFilterChipsMarkup(BOARD.epics),
    epicStripRollupMarkup:  perEpic(EpicMarkup.epicStripRollupMarkup),
    otherEpicSquaresMarkup: { 'every epic': EpicMarkup.otherEpicSquaresMarkup(BOARD.epics), 'none': EpicMarkup.otherEpicSquaresMarkup([]) },
    doneTicketCountOf:      perEpic(EpicMarkup.doneTicketCountOf),
    openTicketCountOf:      perEpic(EpicMarkup.openTicketCountOf),
  };
}
