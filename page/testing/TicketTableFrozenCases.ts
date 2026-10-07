/**
 * The Tickets tab's table over one fixture board of two epics: the status, type and epic chips, the rows ungrouped with and without the
 * epic column and with a search marking titles, groups and branches, the rows grouped under each epic's head row as the controller groups
 * them, and the empty row narrowed and not. `page/tickets/TicketsMarkup.frozen.spec.ts` compares it against
 * `page/testing/FrozenTicketTables.json`. Test-only: nothing that ships may import `page/testing/`.
 */
import type { EpicFrontmatter }        from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }                   from '../../src/lib/tracker-model/@types/Task.ts';
import { TICKET_TYPES }                from '../../src/lib/tracker-model/constants/TicketFields.ts';
import type { PageTicket }             from '../../src/shared/@types/PagePayload.ts';
import type { BoardTicket }            from '../@types/PageBoard.ts';
import { NO_EPIC_CHIP }                from '../constants/EpicChips.ts';
import { EpicMarkup }                  from '../epics/EpicMarkup.ts';
import type { TicketTableRowsOptions } from '../tickets/TicketsMarkup.ts';
import {
  emptyTicketTableMarkup,
  statusChipsMarkup,
  ticketTableColumnCountOf,
  ticketTableRowsMarkup,
  typeChipsMarkup,
} from '../tickets/TicketsMarkup.ts';
import { DEFAULT_TICKET_VIEW, TICKET_STATUS_CHIPS } from '../tickets/utils/TicketViewUtil.ts';
import { pageBoardFixture }                         from './PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }                      from './PageLimitsFixture.ts';

function exampleTicket(id: string, changes: Partial<PageTicket>): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'feature',
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
];

const TICKETS: PageTicket[] = [
  exampleTicket('001', {
    title: 'Single-page checkout', status: 'in-progress', started: '2026-09-18T09:00:00+02:00', task: 1, epics: ['checkout', 'emails'], branch: 'ticket/checkout'
  }),
  exampleTicket('002', {
    title: 'Address form & mail', type: 'bug', status: 'in-review', task: 2, epics: ['checkout'], dependsOn: ['001'], group: 'mail-group', branch: 'ticket/mail-form'
  }),
  exampleTicket('003', {
    title: 'Receipt mail', type: 'change', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00', epics: ['emails'], priority: 'high'
  }),
  exampleTicket('004', {
    title: 'Paused <work>', status: 'in-progress', started: '2026-09-18T10:00:00+02:00', task: 4, priority: 'low'
  }),
];

const ROWS: Task[] = [
  {
    id: 1, name: 'Row 1', status: 'in-progress', start: '2026-09-18T09:00:00+02:00', end: null, owner: 'Alex Example', note: '', ticket: '001', tokens: null,
  },
  {
    id: 2, name: 'Row 2', status: 'in-review', start: '2026-09-18T09:10:00+02:00', end: null, owner: 'Alex Example', note: '', ticket: '002', tokens: null,
  },
  {
    id: 4, name: 'Row 4', status: 'paused', start: '2026-09-18T10:00:00+02:00', end: null, owner: 'Alex Example', note: 'Waiting for a slot', ticket: '004', tokens: null,
  },
];

const BOARD         = pageBoardFixture({ tasks: ROWS, tickets: TICKETS, epics: EPICS });
const NOW           = Date.parse('2026-09-18T22:00:00+02:00');
const TODAY         = '2026-09-18';
const EPIC_FORMAT   = { limits: EXAMPLE_PAGE_LIMITS, todayCalendarDate: TODAY, nowEpochMilliseconds: NOW };
const COLUMN_COUNT  = ticketTableColumnCountOf(true);

function rowOptionsOf(showsEpicColumn: boolean): TicketTableRowsOptions {
  return { format: { nowEpochMilliseconds: NOW, todayCalendarDate: TODAY, slices: EXAMPLE_PAGE_LIMITS }, showsEpicColumn, allTickets: BOARD.tickets };
}

function epicTitleOf(chip: string): string {
  return BOARD.epics.find((epic) => epic.key === chip)?.title ?? chip;
}

/** As the Tickets controller groups them: each epic's tickets under its head row, a ticket under its primary epic only, then the rest. */
function groupedRowsMarkup(tickets: readonly BoardTicket[], searchText: string): string {
  return [...EpicMarkup.epicsInShownOrder(BOARD.epics), null].map((epic) => {
    const members = tickets.filter((ticket) => (ticket.memberOfEpics[0]?.key ?? null) === (epic?.key ?? null));
    return members.length === 0 ? '' : EpicMarkup.epicGroupRowMarkup(epic, COLUMN_COUNT, EPIC_FORMAT) + ticketTableRowsMarkup(members, searchText, rowOptionsOf(true));
  }).join('');
}

/** Each part's markup, keyed by the part and then by the case it was drawn for. */
export function ticketTableFrozenCases(): Record<string, unknown> {
  return {
    chips: {
      status: statusChipsMarkup(TICKET_STATUS_CHIPS),
      type:   typeChipsMarkup(TICKET_TYPES),
      epic:   EpicMarkup.epicFilterChipsMarkup(BOARD.epics),
    },
    ungroupedRows: {
      'without the epic column': ticketTableRowsMarkup(BOARD.tickets, '', rowOptionsOf(false)),
      'with the epic column':    ticketTableRowsMarkup(BOARD.tickets, '', rowOptionsOf(true)),
      'searching mail':          ticketTableRowsMarkup(BOARD.tickets, '  MAIL ', rowOptionsOf(true)),
      'searching an id':         ticketTableRowsMarkup(BOARD.tickets, '#002', rowOptionsOf(true)),
    },
    groupedRows: {
      'every ticket':   groupedRowsMarkup(BOARD.tickets, ''),
      'searching mail': groupedRowsMarkup(BOARD.tickets, 'mail'),
    },
    emptyRow: {
      'nothing narrows': emptyTicketTableMarkup(DEFAULT_TICKET_VIEW, COLUMN_COUNT, epicTitleOf),
      'every narrowing': emptyTicketTableMarkup({
        ...DEFAULT_TICKET_VIEW, searchText: ' <refund> ', statusChips: ['paused', 'reviewing'], typeChips: ['bug'], epicChips: ['checkout', NO_EPIC_CHIP],
      }, COLUMN_COUNT, epicTitleOf),
    },
  };
}
