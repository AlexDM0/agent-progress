/**
 * `taskRowsMarkup` over the boards the two chart specs build: review rows as segments and as rows of their own, tokens, ticket badges, a
 * paused row's phases, a reviewed delivery, a waiting note, and epic head rows open and folded. Each row's bar comes from the geometry, so
 * the phases and the live hatch show. `GanttChartMarkup.frozen.spec.ts` compares it against `page/testing/FrozenGanttChartRows.json`.
 * Test-only: nothing that ships may import `page/testing/`.
 */
import type { EpicFrontmatter }                          from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }                                     from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                               from '../../src/shared/@types/PagePayload.ts';
import type { PageBoard }                                from '../@types/PageBoard.ts';
import { NO_EPIC_CHIP }                                  from '../constants/EpicChips.ts';
import { EpicGroupMarks }                                from '../epics/EpicGroupMarks.ts';
import type { EpicGrouping, TaskRow }                    from '../progress/GanttChartMarkup.ts';
import { taskRowsMarkup }                                from '../progress/GanttChartMarkup.ts';
import { GeometryUtil }                                  from '../utils/GeometryUtil.ts';
import { pageBoardFixture }                              from './PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS, EXAMPLE_TIMESTAMP_SLICES } from './PageLimitsFixture.ts';

const NOW_EPOCH_MILLISECONDS = Date.parse('2026-09-18T22:00:00+02:00');
const TODAY_CALENDAR_DATE    = '2026-09-18';

const CHECKOUT: EpicFrontmatter = {
  key: 'checkout-redesign', title: 'Checkout <redesign>', slot: 1, extra: []
};
const BILLING: EpicFrontmatter  = {
  key: 'billing', title: 'Billing', slot: 2, extra: []
};

function exampleTask(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example task ${id}`,
    status: 'in-progress',
    start:  '2026-09-18T20:30:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'in-progress',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
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

/**
 * Ticket 001 in review with two passes, the second open; 002 delivered and reviewed; 003 waiting on 001, unstarted; row 4 free-standing and
 * paused after a phase in progress, with tokens; row 7 a review of a ticket whose own row is not drawn.
 */
function exampleBoard(epics: readonly EpicFrontmatter[]): PageBoard {
  return pageBoardFixture({
    tasks: [
      exampleTask(1, {
        name: '#001 Split the exporter', ticket: '001', status: 'in-review', end: '2026-09-18T21:00:00+02:00', tokens: 12_300,
      }),
      exampleTask(2, {
        ticket: '002', status: 'delivered', start: '2026-09-18T19:00:00+02:00', end: '2026-09-18T20:00:00+02:00', reviewed: '2026-09-18T19:50:00+02:00',
      }),
      exampleTask(3, { ticket: '003', status: 'pending', start: null }),
      exampleTask(4, {
        status:  'paused',
        tokens:  1_900,
        history: [{ status: 'in-progress', at: '2026-09-18T20:30:00+02:00' }, { status: 'paused', at: '2026-09-18T21:15:00+02:00' }],
      }),
      exampleTask(5, {
        name: 'Review 1 #001', reviewOf: '001', reviewBarRound: 1, status: 'delivered', start: '2026-09-18T21:00:00+02:00', end: '2026-09-18T21:20:00+02:00',
      }),
      exampleTask(6, {
        name: 'Review 2 #001', reviewOf: '001', reviewBarRound: 2, start: '2026-09-18T21:30:00+02:00', tokens: 0,
      }),
      exampleTask(7, {
        name: 'Review 1 #009', reviewOf: '009', reviewBarRound: 1, start: '2026-09-18T21:40:00+02:00'
      }),
    ],
    tickets: [
      exampleTicket('001', { task: 1, status: 'in-review', epics: ['checkout-redesign', 'billing'] }),
      exampleTicket('002', { task: 2, status: 'delivered', epics: ['billing'] }),
      exampleTicket('003', { task: 3, status: 'pending' }),
    ],
    epics,
  });
}

function taskRowsOf(board: PageBoard): TaskRow[] {
  const timeline = GeometryUtil.computeTimeline({
    progress: {
      trackerId: 'example', project: 'Example', startedAt: '2026-09-18T19:00:00+02:00', view: { kind: 'auto' }, nextTaskId: 8, tasks: [...board.rows]
    },
    range:                { kind: 'auto' },
    nowEpochMilliseconds: NOW_EPOCH_MILLISECONDS,
    limits:               EXAMPLE_PAGE_LIMITS,
  });
  return board.rows.flatMap((task, index) => {
    const bar = timeline.bars[index];
    return bar === undefined ? [] : [{ task, bar, waitingOn: task.ticket === '003' ? ['001'] : [] }];
  });
}

function groupingOf(board: PageBoard, foldedGroupKeys: readonly string[]): EpicGrouping {
  return {
    epics:                   EpicGroupMarks.epicsInShownOrder(board.epics),
    epicsOfTicket:           new Map(board.tickets.map((ticket) => [ticket.id, ticket.memberOfEpics])),
    foldedGroupKeys:         new Set(foldedGroupKeys),
    axis:                    { fromEpochMilliseconds: Date.parse('2026-09-18T19:00:00+02:00'), toEpochMilliseconds: NOW_EPOCH_MILLISECONDS },
    nowEpochMilliseconds:    NOW_EPOCH_MILLISECONDS,
    minimumSpanWidthPercent: EXAMPLE_PAGE_LIMITS.minimumBarWidthPercent,
  };
}

export function ganttChartFrozenCases(): Record<string, string> {
  const ungrouped = exampleBoard([]);
  const grouped   = exampleBoard([BILLING, CHECKOUT]);
  const drawing   = { slices: EXAMPLE_TIMESTAMP_SLICES, todayCalendarDate: TODAY_CALENDAR_DATE };
  const foldedBillingAndNoEpic = groupingOf(grouped, ['billing', NO_EPIC_CHIP]);
  return {
    'review segments':                 taskRowsMarkup(taskRowsOf(ungrouped), { ...drawing, reviewRowsAreShown: false }),
    'review rows shown':               taskRowsMarkup(taskRowsOf(ungrouped), { ...drawing, reviewRowsAreShown: true }),
    'epic head rows':                  taskRowsMarkup(taskRowsOf(grouped), { ...drawing, reviewRowsAreShown: false, epicGrouping: groupingOf(grouped, []) }),
    'epic head rows with review rows': taskRowsMarkup(taskRowsOf(grouped), { ...drawing, reviewRowsAreShown: true, epicGrouping: groupingOf(grouped, []) }),
    'epic head rows folded':           taskRowsMarkup(taskRowsOf(grouped), { ...drawing, reviewRowsAreShown: false, epicGrouping: foldedBillingAndNoEpic }),
  };
}
