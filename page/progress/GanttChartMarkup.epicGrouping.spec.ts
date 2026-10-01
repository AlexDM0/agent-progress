/**
 * The Progress chart's rows grouped under their epics. The cases that matter: a ticket is drawn once, under its primary epic, with
 * the squares of its other epics, and that other epic's head counts it as shared; review rows travel with their ticket; rows of no
 * epic, free-standing ones included, trail under "No epic"; a folded group keeps only its head; the head's span follows the epic's
 * roll-up on the axis; and a board without epics draws exactly the ungrouped rows.
 */

import { describe, expect, test }                      from 'bun:test';
import type { EpicFrontmatter }                        from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }                                   from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                             from '../../src/shared/@types/PagePayload.ts';
import type { PageBoard }                              from '../@types/PageBoard.ts';
import type { TimelineBar }                            from '../@types/Timeline.ts';
import { NO_EPIC_CHIP }                                from '../constants/EpicChips.ts';
import { EpicMarkup }                                  from '../epics/EpicMarkup.ts';
import { pageBoardFixture }                            from '../testing/PageBoardFixture.ts';
import { EXAMPLE_TIMESTAMP_SLICES }                    from '../testing/PageLimitsFixture.ts';
import type { EpicGrouping, TaskRow, TaskRowsDrawing } from './GanttChartMarkup.ts';
import { taskRowsMarkup }                              from './GanttChartMarkup.ts';

const PLACED_BAR: TimelineBar = {
  taskId:       1,
  leftPercent:  10,
  widthPercent: 25,
  clippedLeft:  false,
  clippedRight: false,
  visible:      true,
  phases:       [],
};

const AXIS_START = Date.parse('2026-09-18T20:00:00+02:00');
const AXIS_END   = Date.parse('2026-09-18T22:00:00+02:00');

const CHECKOUT: EpicFrontmatter = {
  key: 'checkout-redesign', title: 'Checkout redesign', slot: 1, extra: []
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

function exampleTicket(id: string, task: number | null, epics: readonly string[]): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'feature',
    status:      'in-progress',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '',
    ...epics.length === 0 ? {} : { epics: [...epics] },
  };
}

/** Ticket 001 in both epics, checkout first; 002 in billing; 003 in none; row 4 free-standing; row 5 reviews 001. */
function exampleBoard(epics: readonly EpicFrontmatter[] = [BILLING, CHECKOUT]): PageBoard {
  return pageBoardFixture({
    tasks: [
      exampleTask(1, {
        ticket: '001', start: '2026-09-18T20:30:00+02:00', end: '2026-09-18T21:00:00+02:00', status: 'in-review'
      }),
      exampleTask(2, { ticket: '002' }),
      exampleTask(3, { ticket: '003' }),
      exampleTask(4),
      exampleTask(5, {
        name: 'Review 1 #001', reviewOf: '001', reviewBarRound: 1, start: '2026-09-18T21:00:00+02:00'
      }),
    ],
    tickets: [
      exampleTicket('001', 1, ['checkout-redesign', 'billing']),
      exampleTicket('002', 2, ['billing']),
      exampleTicket('003', 3, []),
    ],
    epics,
  });
}

function taskRowsOf(board: PageBoard): TaskRow[] {
  return board.rows.map((task) => ({ task, bar: { ...PLACED_BAR, taskId: task.id }, waitingOn: [] }));
}

function groupingOf(board: PageBoard, foldedGroupKeys: readonly string[] = []): EpicGrouping {
  return {
    epics:                   EpicMarkup.epicsInShownOrder(board.epics),
    epicsOfTicket:           new Map(board.tickets.map((ticket) => [ticket.id, ticket.memberOfEpics])),
    foldedGroupKeys:         new Set(foldedGroupKeys),
    axis:                    { fromEpochMilliseconds: AXIS_START, toEpochMilliseconds: AXIS_END },
    nowEpochMilliseconds:    Date.parse('2026-09-18T21:30:00+02:00'),
    minimumSpanWidthPercent: 0.4,
  };
}

function drawingOf(board: PageBoard, changes: Partial<TaskRowsDrawing> = {}): TaskRowsDrawing {
  return {
    slices:             EXAMPLE_TIMESTAMP_SLICES,
    todayCalendarDate:  '2026-09-18',
    reviewRowsAreShown: false,
    epicGrouping:       groupingOf(board),
    ...changes,
  };
}

/** Each drawn row in order: `head:<key>` for a head row, the task id for a task row. */
function drawnOrderOf(markup: string): string[] {
  return [...markup.matchAll(/<div class="ap-grid-row ap-row[^"]*"[^>]*?(?:data-epic-key="([^"]+)"|data-task-id="(\d+)")/g)]
    .map((match) => (match[1] === undefined ? match[2] ?? '' : `head:${match[1]}`));
}

function headRowOf(markup: string, groupKey: string): string {
  const start = markup.indexOf(`data-epic-key="${groupKey}"`);
  return markup.slice(start, markup.indexOf('</div></div>', markup.indexOf('ap-cell-track', start)));
}

describe('rows grouped under their epics', () => {
  test('draws each epic\'s head before its rows, in shown order, then the rows of no epic, free-standing ones included, under "No epic"', () => {
    const board = exampleBoard();

    expect(drawnOrderOf(taskRowsMarkup(taskRowsOf(board), drawingOf(board)))).toEqual([
      'head:billing',
      '2',
      'head:checkout-redesign',
      '1',
      `head:${NO_EPIC_CHIP}`,
      '4',
      '3',
    ]);
  });

  test('draws a ticket in two epics once, under its primary epic, with a square for the other', () => {
    const board  = exampleBoard();
    const markup = taskRowsMarkup(taskRowsOf(board), drawingOf(board));
    const rowOne = markup.slice(markup.indexOf('data-task-id="1"'), markup.indexOf('ap-cell-pill', markup.indexOf('data-task-id="1"')));

    expect(markup.match(/data-task-id="1"/g)?.length).toBe(1);
    expect(rowOne).toContain('<span class="ap-epic-also" title="Also in Billing">+<span class="ap-epic-swatch" data-epic-slot="2"></span></span>');
    expect(markup.match(/ap-epic-also/g)?.length).toBe(1);
  });

  test('counts a ticket shown under another epic as shared on this epic\'s head, and every ticket in its done count', () => {
    const board  = exampleBoard();
    const markup = taskRowsMarkup(taskRowsOf(board), drawingOf(board));

    expect(headRowOf(markup, 'billing')).toContain('+1 shared');
    expect(headRowOf(markup, 'billing')).toContain('<div class="ap-cell-pill">0 / 2 done</div>');
    expect(headRowOf(markup, 'checkout-redesign')).not.toContain('shared');
    expect(headRowOf(markup, NO_EPIC_CHIP)).toContain('No epic <span class="ap-epic-head-count">2</span>');
  });

  test('keeps a review row with its ticket, directly above it, when the review rows are shown', () => {
    const board = exampleBoard();

    expect(drawnOrderOf(taskRowsMarkup(taskRowsOf(board), drawingOf(board, { reviewRowsAreShown: true })))).toEqual([
      'head:billing',
      '2',
      'head:checkout-redesign',
      '5',
      '1',
      `head:${NO_EPIC_CHIP}`,
      '4',
      '3',
    ]);
  });

  test('leaves only the head of a folded group, marked folded, and every other group open', () => {
    const board  = exampleBoard();
    const markup = taskRowsMarkup(taskRowsOf(board), { ...drawingOf(board), epicGrouping: groupingOf(board, ['checkout-redesign', NO_EPIC_CHIP]) });

    expect(drawnOrderOf(markup)).toEqual(['head:billing', '2', 'head:checkout-redesign', `head:${NO_EPIC_CHIP}`]);
    expect(headRowOf(markup, 'checkout-redesign')).toContain('aria-expanded="false" data-collapsed');
    expect(headRowOf(markup, 'billing')).toContain('aria-expanded="true">');
  });

  test('places the head\'s span from the epic\'s first start to its last end, or now, marked open while a ticket of it is unsettled', () => {
    const board  = exampleBoard();
    const markup = taskRowsMarkup(taskRowsOf(board), drawingOf(board));

    // Checkout's rows run from 20:30 to now (21:30) on a 20:00 to 22:00 axis.
    expect(headRowOf(markup, 'checkout-redesign')).toContain('class="ap-epic-span" data-open style="left:25.00%;width:50.00%"');
    expect(headRowOf(markup, NO_EPIC_CHIP)).not.toContain('ap-epic-span');
  });

  test('draws no span for an epic none of whose rows started, or whose span lies outside the range', () => {
    const board        = exampleBoard();
    const laterAxis    = { fromEpochMilliseconds: AXIS_END, toEpochMilliseconds: AXIS_END + 3_600_000 };
    const closedEpics  = board.epics.map((epic) => ({ ...epic, span: { start: '2026-09-18T20:30:00+02:00', end: '2026-09-18T21:00:00+02:00' } }));
    const unstarted    = board.epics.map((epic) => ({ ...epic, span: null }));
    const outsideRange = taskRowsMarkup(taskRowsOf(board), { ...drawingOf(board), epicGrouping: { ...groupingOf(board), epics: closedEpics, axis: laterAxis } });
    const neverStarted = taskRowsMarkup(taskRowsOf(board), { ...drawingOf(board), epicGrouping: { ...groupingOf(board), epics: unstarted } });

    expect(outsideRange).not.toContain('ap-epic-span');
    expect(neverStarted).not.toContain('ap-epic-span');
  });

  test('escapes a hostile epic title once in the head\'s chip and span title', () => {
    const board  = exampleBoard([{ ...CHECKOUT, title: '<b>Checkout</b>' }, BILLING]);
    const markup = taskRowsMarkup(taskRowsOf(board), drawingOf(board));

    expect(markup).not.toContain('<b>Checkout');
    expect(markup).toContain('&lt;b&gt;Checkout&lt;/b&gt;</span></button>');
    expect(markup).toContain('title="&lt;b&gt;Checkout&lt;/b&gt; · ');
  });

  test('draws a board without epics exactly as the ungrouped chart, with no head rows', () => {
    const board = exampleBoard([]);

    const grouped   = taskRowsMarkup(taskRowsOf(board), drawingOf(board, { epicGrouping: null }));
    const ungrouped = taskRowsMarkup(taskRowsOf(board), { slices: EXAMPLE_TIMESTAMP_SLICES, todayCalendarDate: '2026-09-18', reviewRowsAreShown: false });

    expect(grouped).toBe(ungrouped);
    expect(grouped).not.toContain('ap-epic-head-row');
    expect(drawnOrderOf(grouped)).toEqual(['4', '3', '2', '1']);
  });
});
