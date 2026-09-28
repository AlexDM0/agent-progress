/**
 * The Progress tab's markup: its task rows and their review nesting, the axis layer, the summary and the notes, with every tracker value
 * escaped exactly once.
 */

import { describe, expect, test }                        from 'bun:test';
import type { Task, TaskStatus }                         from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }                             from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { PageTicket }                               from '../../src/shared/@types/PagePayload.ts';
import type { TimelineBar }                              from '../@types/Timeline.ts';
import { pageBoardFixture }                              from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS, EXAMPLE_TIMESTAMP_SLICES } from '../testing/PageLimitsFixture.ts';
import { GeometryUtil }                                  from '../utils/GeometryUtil.ts';
import { TimeUtil }                                      from '../utils/TimeUtil.ts';
import {
  generatedStampText,
  hiddenWorkNoteText,
  overlayMarkup,
  rangeNoteText,
  summaryStatisticsMarkup,
  taskRowsMarkup,
  tickLayerMarkup,
} from './GanttChartMarkup.ts';

const { computeTimeline }                 = GeometryUtil;
const { calendarDateOf, fullInstantText } = TimeUtil;

const MILLISECONDS_PER_MINUTE = 60_000;

const NO_AGENTS_OF_TWO = { limit: 2, agentsInFlight: 0 };

const PLACED_BAR: TimelineBar = {
  taskId:       1,
  leftPercent:  10,
  widthPercent: 25,
  clippedLeft:  false,
  clippedRight: false,
  visible:      true,
};

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   'Split the exporter into two passes',
    status: 'in-progress',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(id: string, status: TicketStatus): PageTicket {
  return {
    id,
    title:       'Split the exporter into two passes',
    type:        'feature',
    status,
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
  };
}

function rowFor(task: Task, ticketStatus: TicketStatus | null = null, bar: TimelineBar = PLACED_BAR, waitingOn: readonly string[] = []): string {
  const ticketId = task.ticket ?? '001';
  const board    = ticketStatus === null
    ? pageBoardFixture({ tasks: [task] })
    : pageBoardFixture({ tasks: [{ ...task, ticket: ticketId }], tickets: [exampleTicket(ticketId, ticketStatus)] });
  const [row] = board.rows;
  if (row === undefined) {
    throw new Error('the example row was not built');
  }
  return taskRowsMarkup([{ task: row, bar, waitingOn }], EXAMPLE_TIMESTAMP_SLICES);
}

describe('taskRowsMarkup', () => {
  test('draws the most recently filed task on top', () => {
    const markup = taskRowsMarkup(rowsFiled([1, 2, 3].map((id) => exampleTask({ id }))), EXAMPLE_TIMESTAMP_SLICES);

    expect([...markup.matchAll(/data-task-id="(\d+)"/g)].map((match) => match[1])).toEqual(['3', '2', '1']);
  });

  // The ladder the chart is read by, in the words every tab uses: every label names the state the row is in, and `Done` means merged.
  test.each<[TaskStatus, string]>([
    ['pending', 'To do'],
    ['in-progress', 'In progress'],
    ['paused', 'Paused'],
    ['in-review', 'Awaiting review'],
    ['re-review', 'Reviewing (round 2)'],
    ['reviewed', 'Awaiting merge'],
    ['delivered', 'Done'],
    ['abandoned', 'Abandoned'],
  ])('gives a %s row exactly one pill reading %s', (status, label) => {
    const markup = rowFor(exampleTask({ status }));

    expect(markup).toContain(`data-state="${status}"`);
    expect(markup).toContain(`<div class="ap-cell-pill"><span class="ap-pill">${label}</span></div>`);
    expect(markup.match(/ap-pill/g)?.length).toBe(1);
  });

  test('marks a delivered row that was reviewed, with the review time in its title', () => {
    const markup = rowFor(exampleTask({ status: 'delivered', reviewed: '2026-09-18T21:10:00+02:00' }));

    expect(markup).toContain('class="ap-reviewed-mark"');
    expect(markup).toContain('title="Reviewed 2026-09-18 21:10 before delivery"');
  });

  test('leaves the mark off a row delivered straight from in-review, and off a reviewed row that is not delivered yet', () => {
    expect(rowFor(exampleTask({ status: 'delivered' }))).not.toContain('ap-reviewed-mark');
    expect(rowFor(exampleTask({ status: 'reviewed', reviewed: '2026-09-18T21:10:00+02:00' }))).not.toContain('ap-reviewed-mark');
  });

  // Rows written before the stamp existed: delivery of a ticket is only legal from `reviewed`.
  test('marks a delivered ticket row as reviewed even when it carries no stamp', () => {
    expect(rowFor(exampleTask({ status: 'delivered', ticket: '003' }), 'delivered')).toContain('ap-reviewed-mark');
  });

  test('says which tickets a row is waiting on, each linked to its card', () => {
    const markup = rowFor(exampleTask({ status: 'pending', ticket: '005' }), 'pending', PLACED_BAR, ['003', '004']);

    expect(markup).toContain('<span class="ap-waiting">waiting on <a href="#ap-ticket-003">#003</a>, <a href="#ap-ticket-004">#004</a></span>');
  });

  test('writes no waiting note on a row that waits on nothing', () => {
    expect(rowFor(exampleTask())).not.toContain('ap-waiting');
  });

  test('gives a reviewing row the reviewing state and label', () => {
    const markup = rowFor(exampleTask({ status: 'in-review' }), 'in-review');

    expect(markup).toContain('data-state="reviewing"');
    expect(markup).toContain('<span class="ap-pill">Reviewing</span>');
  });

  test('numbers the pill of a row that is on its third review pass', () => {
    const markup = rowFor(exampleTask({ status: 're-review', reviewRound: 3 }), 'in-review');

    expect(markup).toContain('data-state="re-review"');
    expect(markup).toContain('<span class="ap-pill">Reviewing (round 3)</span>');
  });

  // A row moved by hand to the repeat state has no round on it; the state itself says it is at least the second pass.
  test('reads a repeat review with no round recorded as the second pass', () => {
    expect(rowFor(exampleTask({ status: 're-review' }))).toContain('<span class="ap-pill">Reviewing (round 2)</span>');
  });

  test('leaves every other status alone whatever its ticket says', () => {
    expect(rowFor(exampleTask({ status: 'in-progress' }), 'in-review')).toContain('data-state="in-progress"');
    expect(rowFor(exampleTask({ status: 'in-review' }), 'reviewed')).toContain('data-state="in-review"');
  });

  test('carries the ids the ticket table and the fragment contract link to', () => {
    const markup = rowFor(exampleTask({ id: 7, ticket: '003' }));

    expect(markup).toContain('id="ap-task-7"');
    expect(markup).toContain('data-task-id="7"');
    expect(markup).toContain('<a class="ap-ticket-badge" href="#ap-ticket-003">#003</a>');
  });

  // Enter on a focused row is the keyboard's only way to the overview panel, and a row the Tab key skips cannot be focused.
  test('lets the keyboard focus the row', () => {
    expect(rowFor(exampleTask())).toContain('<div class="ap-grid-row ap-row" tabindex="0" id="ap-task-1"');
  });

  test('leaves out the ticket badge for a free-standing task', () => {
    expect(rowFor(exampleTask())).not.toContain('ap-ticket-badge');
  });

  test('shows a token figure only when the task reports one', () => {
    expect(rowFor(exampleTask({ tokens: 12_300 }))).toContain('<span class="ap-tokens">12.3k tokens</span>');
    expect(rowFor(exampleTask({ tokens: 0 }))).toContain('<span class="ap-tokens">0 tokens</span>');
    expect(rowFor(exampleTask({ tokens: null }))).not.toContain('ap-tokens');
  });

  test('places the bar as percentages and shows a clip marker only on the edge it ran off', () => {
    const markup = rowFor(exampleTask(), null, { ...PLACED_BAR, clippedLeft: true });

    expect(markup).toContain('style="left:10.00%;width:25.00%"');
    expect(markup).toContain('<span class="ap-clip-l"></span>');
    expect(markup).toContain('<span class="ap-clip-r" hidden></span>');
  });

  test('hides the bar of a task that never started, keeping the three track children', () => {
    const markup = rowFor(exampleTask({ start: null }), null, { ...PLACED_BAR, visible: false });

    expect(markup).toContain('<div class="ap-bar" hidden');
    expect(markup).toContain('<span class="ap-clip-l" hidden></span>');
  });

  test('escapes a hostile task name in the text and in the title alike', () => {
    const markup = rowFor(exampleTask({ name: '<img src=x onerror="alert(1)">' }));

    expect(markup).not.toContain('<img');
    expect(markup).toContain('title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"');
  });
});

function rowsFiled(tasks: readonly Task[]): Parameters<typeof taskRowsMarkup>[0] {
  return pageBoardFixture({ tasks }).rows.map((task) => ({ task, bar: PLACED_BAR, waitingOn: [] }));
}

function drawnOrderOf(markup: string): Array<[taskId: string, reviewOf: string | null]> {
  return [...markup.matchAll(/data-task-id="(\d+)" data-state="[^"]+"(?: data-review-of="(\d+)")?/g)].map((match) => [match[1] ?? '', match[2] ?? null]);
}

// A review pass belongs to its ticket: it is drawn above the ticket's own row rather than wherever its start time put it.
describe('review rows nested above their ticket', () => {
  test('draws the review rows directly above the ticket, indented, latest round first', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, name: 'Split the exporter', ticket: '003' }),
      exampleTask({ id: 2, name: 'Regenerate the fixtures' }),
      exampleTask({
        id:             3,
        name:           'Review 1 #3 — Split the exporter',
        reviewOf:       '003',
        reviewBarRound: 1,
      }),
      exampleTask({ id: 4, name: 'Brighter colours', ticket: '004' }),
      exampleTask({
        id:             5,
        name:           'Review 2 #3 — Split the exporter',
        reviewOf:       '003',
        reviewBarRound: 2,
      }),
      exampleTask({
        id:             6,
        name:           'Review 3 #3 — Split the exporter',
        reviewOf:       '003',
        reviewBarRound: 3,
      }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([
      ['4', null],
      ['2', null],
      ['6', '003'],
      ['5', '003'],
      ['3', '003'],
      ['1', null],
    ]);
  });

  // Only a later round filed earlier tells a round sort from a filing sort.
  test('orders review rows by the round their name gives, not by when they were filed', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, name: 'Review 2 #3 — Split the exporter', reviewOf: '003' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — Split the exporter', reviewOf: '003' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', '003'], ['3', '003'], ['1', null]]);
  });

  test('draws a review row whose name gives no round above the numbered rounds', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 3, name: 'Review 2 #3 — Split the exporter', reviewOf: '003' }),
      exampleTask({ id: 4, name: 'Review 1 #3 — Split the exporter', reviewOf: '003' }),
      exampleTask({ id: 5, name: 'A second look', reviewOf: '003' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['5', '003'], ['3', '003'], ['4', '003'], ['1', null]]);
  });

  // Two rows naming one ticket: the Board's own row is the first, so the bar goes above that one.
  test('nests a review above the first row naming its ticket, not the last', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, ticket: '003' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — Split the exporter', reviewOf: '003' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['3', '003'], ['1', null]]);
  });

  test('leaves a review at the top level when its ticket\'s own row is hidden', () => {
    const [ownRow, bar] = rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, name: 'Review 1 #3 — Split the exporter', reviewOf: '003' }),
    ]);
    if (ownRow === undefined || bar === undefined) {
      throw new Error('the example rows were not built');
    }
    const markup = taskRowsMarkup([bar], EXAMPLE_TIMESTAMP_SLICES);

    expect(bar.task.ownRowOfReviewedTicket).toBe(ownRow.task);
    expect(drawnOrderOf(markup)).toEqual([['2', null]]);
  });

  // Two rows of one round: the filing order decides here as it does between rounds.
  test('draws the later-filed of two review rows of the same round first', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, name: 'Review 1 #3 — Split the exporter', reviewOf: '003' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — Split the exporter', reviewOf: '003' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['3', '003'], ['2', '003'], ['1', null]]);
  });

  test('puts the flag ahead of the name, so a review named for one ticket but filed against another nests above the flagged one', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, ticket: '004' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — x', reviewOf: '004' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['3', '004'], ['2', null], ['1', null]]);
  });

  test('draws a bundle review once, above the first ticket it names', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '013' }),
      exampleTask({ id: 2, ticket: '005' }),
      exampleTask({
        id:             3,
        name:           'Review 1 #13, #5 — the bundle',
        reviewOf:       '013',
        reviewBarRound: 1,
      }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['3', '013'], ['1', null]]);
    expect(markup.match(/data-task-id="3"/g)?.length).toBe(1);
  });

  // A ticket not started, or hidden as long done, has no row here; its review must neither vanish nor move.
  test('leaves a review whose ticket has no row, and a free-standing row, where the filing order puts them, without an indent', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, name: 'Regenerate the fixtures' }),
      exampleTask({
        id:             2,
        name:           'Review 1 #7 — a ticket with no row',
        reviewOf:       '007',
        reviewBarRound: 1,
      }),
      exampleTask({ id: 3, name: 'Review pass of the whole surface' }),
      exampleTask({ id: 4, name: 'Review 1 #8 — linked by flag', reviewOf: '008' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['4', null], ['3', null], ['2', null], ['1', null]]);
    expect(markup).not.toContain('data-review-of');
  });

  test('never nests a ticket\'s own row, even one whose name reads like a review', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, name: 'Review 1 #3 — misnamed', ticket: '009' }),
    ]), EXAMPLE_TIMESTAMP_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['1', null]]);
  });
});

describe('summaryStatisticsMarkup', () => {
  // Work completed is the settled rows over the total, and the two figures beside it are what is still owed: a merge, and a review.
  test('reads in the same ladder as the pills: work completed out of the total, then what is awaited', () => {
    const markup = summaryStatisticsMarkup([
      exampleTask({ id: 1, status: 'pending' }),
      exampleTask({ id: 2, status: 'in-review' }),
      exampleTask({ id: 3, status: 'reviewed' }),
      exampleTask({ id: 4, status: 'delivered' }),
    ], NO_AGENTS_OF_TWO);

    expect(markup).toContain('Work completed: <span class="ap-stat-n">1 / 4</span>');
    expect(markup).toContain('<span class="ap-stat-n">1</span> awaiting merge');
    expect(markup).toContain('<span class="ap-stat-n">1</span> in review');
  });

  // An abandoned row has nothing left to do, so a board of only delivered and abandoned rows must not read as unfinished.
  test('counts an abandoned row as completed, so a settled board reads its total over its total', () => {
    const inFlight = summaryStatisticsMarkup([
      exampleTask({ id: 1, status: 'delivered' }),
      exampleTask({ id: 2, status: 'delivered' }),
      exampleTask({ id: 3, status: 'abandoned' }),
      exampleTask({ id: 4, status: 'in-progress' }),
    ], NO_AGENTS_OF_TWO);
    const settled = summaryStatisticsMarkup([
      exampleTask({ id: 1, status: 'delivered' }),
      exampleTask({ id: 2, status: 'abandoned' }),
      exampleTask({ id: 3, status: 'abandoned' }),
    ], NO_AGENTS_OF_TWO);

    expect(inFlight).toContain('Work completed: <span class="ap-stat-n">3 / 4</span></button>');
    expect(settled).toContain('Work completed: <span class="ap-stat-n">3 / 3</span>');
  });

  // A delivered row is completed and nothing else: it is not still awaiting the merge it already had.
  test('counts a row sent round for another review as in review, and a delivered row only as completed', () => {
    const markup = summaryStatisticsMarkup([
      exampleTask({ id: 1, status: 're-review', reviewRound: 3 }),
      exampleTask({ id: 2, status: 'reviewed' }),
      exampleTask({ id: 3, status: 'delivered' }),
    ], NO_AGENTS_OF_TWO);

    expect(markup).toContain('Work completed: <span class="ap-stat-n">1 / 3</span>');
    expect(markup).toContain('<span class="ap-stat-n">1</span> awaiting merge');
    expect(markup).toContain('<span class="ap-stat-n">1</span> in review');
  });

  test('sums the reported token counts and omits the figure when none were reported', () => {
    const reported = summaryStatisticsMarkup([exampleTask({ tokens: 12_300 }), exampleTask({ id: 2, tokens: 50_100 })], NO_AGENTS_OF_TWO);

    expect(reported).toContain('<span class="ap-stat-n">62.4k</span> tokens');
    expect(summaryStatisticsMarkup([exampleTask()], NO_AGENTS_OF_TWO)).not.toContain('tokens');
  });

  test('separates the statistics with the design’s middot', () => {
    expect(summaryStatisticsMarkup([exampleTask()], NO_AGENTS_OF_TWO)).toContain('<span class="ap-sep">&middot;</span>');
  });

  // The figures are the ones `status --json` reports, handed in; the line must print them as given rather than count the rows itself.
  test('prints the agents in flight against the limit as handed in, not a count of the running rows', () => {
    const markup = summaryStatisticsMarkup([exampleTask({ status: 'in-progress' })], { limit: 3, agentsInFlight: 2 });

    expect(markup).toContain('<span class="ap-stat-n">2 of 3</span> agents running</button>');
  });

  // The summary is navigation: each state figure names the lane it opens and says so to a screen reader, while the token total has no lane.
  test('makes each state figure a button for its Kanban lane, named for what it shows, and leaves the token figure plain text', () => {
    const markup = summaryStatisticsMarkup([
      exampleTask({ id: 1, status: 'in-review', tokens: 1_000 }),
      exampleTask({ id: 2, status: 're-review', reviewRound: 2 }),
      exampleTask({ id: 3, status: 'reviewed' }),
      exampleTask({ id: 4, status: 'delivered' }),
    ], { limit: 2, agentsInFlight: 1 });

    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="done" aria-label="Show 1 / 4 work completed on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="merge" aria-label="Show 1 awaiting merge on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="review" aria-label="Show 2 in review on Kanban">');
    expect(markup).toContain('<button type="button" class="ap-stat" data-kanban-lane="progress" aria-label="Show 1 of 2 agents running on Kanban">');
    expect(markup).toContain('<span class="ap-stat"><span class="ap-stat-n">1k</span> tokens</span>');
    expect(markup.match(/<button /g)).toHaveLength(4);
  });

  test('reads a fresh board as none of the default two agents running', () => {
    expect(summaryStatisticsMarkup([], NO_AGENTS_OF_TWO)).toContain('<span class="ap-stat-n">0 of 2</span> agents running');
  });

  test('speaks of one agent in the singular when the limit is one', () => {
    expect(summaryStatisticsMarkup([], { limit: 1, agentsInFlight: 1 })).toContain('<span class="ap-stat-n">1 of 1</span> agent running');
  });
});

describe('the axis layer', () => {
  const ticks = [
    { leftPercent: 0, label: '20:30', labelSitsLeftOfItsLine: false },
    { leftPercent: 98.97, label: '22:15', labelSitsLeftOfItsLine: true },
  ];

  test('writes each tick at its own percentage with its label', () => {
    const markup = tickLayerMarkup(ticks);

    expect(markup).toContain('<div class="ap-tick" style="left:0.00%"><span>20:30</span></div>');
    expect(markup).toContain('<span style="left:auto;right:5px">22:15</span>');
  });

  test('draws one grid line per tick and hides the now marker when the present moment is out of range', () => {
    expect(overlayMarkup(ticks, 78.5)).toBe(
      '<div class="ap-grid-line" style="left:0.00%"></div>'
      + '<div class="ap-grid-line" style="left:98.97%"></div>'
      + '<div id="ap-now" style="--now-x:78.50%"></div>',
    );
    expect(overlayMarkup(ticks, null)).toContain('<div id="ap-now" hidden></div>');
  });

  test('writes the tick step in the largest unit that divides it', () => {
    const from  = Date.UTC(2026, 8, 18, 18, 30, 0);
    const today = calendarDateOf(from);

    expect(rangeNoteText(from, from + 105 * MILLISECONDS_PER_MINUTE, 15, today, EXAMPLE_PAGE_LIMITS).text).toContain('· 15m ticks');
    expect(rangeNoteText(from, from + 105 * MILLISECONDS_PER_MINUTE, 360, today, EXAMPLE_PAGE_LIMITS).text).toContain('· 6h ticks');
    expect(rangeNoteText(from, from + 105 * MILLISECONDS_PER_MINUTE, 1440, today, EXAMPLE_PAGE_LIMITS).text).toContain('· 1d ticks');
  });

  // Each end is judged against the viewer's day on its own, and the title is always the whole note in full.
  test('dates an end only when it falls on another day than today, and titles the note with both ends in full', () => {
    const to        = Date.UTC(2026, 8, 18, 12, 0, 0);
    const today     = calendarDateOf(to);
    const sameDay   = rangeNoteText(to - 60 * MILLISECONDS_PER_MINUTE, to, 15, today, EXAMPLE_PAGE_LIMITS);
    const threeDays = rangeNoteText(to - 3 * 1440 * MILLISECONDS_PER_MINUTE, to, 1440, today, EXAMPLE_PAGE_LIMITS);

    expect(sameDay.text).toMatch(/^\d\d:\d\d → \d\d:\d\d · 15m ticks$/);
    expect(threeDays.text).toMatch(/^\d\d-\d\d \d\d:\d\d → \d\d:\d\d · 1d ticks$/);
    expect(threeDays.title).toBe(`${fullInstantText(to - 3 * 1440 * MILLISECONDS_PER_MINUTE)} → ${fullInstantText(to)} · 1d ticks`);
  });

  test('carries no title on a note whose ends are both from another year, since nothing was shortened', () => {
    const to   = Date.UTC(2025, 5, 1, 12, 0, 0);
    const note = rangeNoteText(to - 60 * MILLISECONDS_PER_MINUTE, to, 15, '2026-09-18', EXAMPLE_PAGE_LIMITS);

    expect(note.text).toMatch(/^2025-\d\d-\d\d \d\d:\d\d → 2025-\d\d-\d\d \d\d:\d\d · 15m ticks$/);
    expect(note.title).toBeNull();
  });

  /**
   * The ticks and the note follow different rules on purpose: a tick is an axis label, dated by the span the axis covers, while the note's
   * ends are stamps, dated only when they fall on another day than the viewer's. A 24h range ending now dates every tick and not its `to` end.
   */
  test('dates the ticks of a day-long range while the note leaves its today end clock-only', () => {
    const to       = Date.UTC(2026, 8, 18, 18, 30, 0);
    const from     = to - 1440 * MILLISECONDS_PER_MINUTE;
    const timeline = computeTimeline({
      progress: {
        trackerId:  'example-tracker',
        project:    'Example Agency',
        startedAt:  new Date(from).toISOString(),
        nextTaskId: 1,
        view:       { kind: 'auto' },
        tasks:      [],
      },
      range: {
        kind:        'absolute',
        from:        new Date(from).toISOString(),
        to:          new Date(to).toISOString(),
        tickMinutes: null,
      },
      nowEpochMilliseconds: to,
      limits:               EXAMPLE_PAGE_LIMITS,
    });
    const clockOnly = /^\d\d:\d\d$/;
    const note      = rangeNoteText(from, to, timeline.stepMinutes, calendarDateOf(to), EXAMPLE_PAGE_LIMITS);

    expect(timeline.ticks.length).toBeGreaterThan(0);
    expect(timeline.ticks.every((tick) => !clockOnly.test(tick.label))).toBe(true);
    expect(note.text).toMatch(/→ \d\d:\d\d · /);
  });
});

describe('generatedStampText', () => {
  // The header's stamp follows the same rule as every other: the template's `generated 21:56` is today's page.
  test('shows only the clock of a page generated today, with the full stamp as the title', () => {
    const generatedAt = Date.UTC(2026, 8, 18, 19, 56, 0);
    const stamp       = generatedStampText(generatedAt, calendarDateOf(generatedAt));

    expect(stamp.text).toMatch(/^generated \d\d:\d\d$/);
    expect(stamp.title).toBe(`generated ${fullInstantText(generatedAt)}`);
  });

  test('dates a page generated on another day', () => {
    const generatedAt = Date.UTC(2026, 8, 17, 12, 0, 0);
    const stamp       = generatedStampText(generatedAt, calendarDateOf(generatedAt + 1440 * MILLISECONDS_PER_MINUTE));

    expect(stamp.text).toBe(`generated ${fullInstantText(generatedAt).slice(5)}`);
  });
});

describe('hiddenWorkNoteText', () => {
  test('names only the kinds that have hidden items, and says nothing when none are hidden', () => {
    expect(hiddenWorkNoteText(0, 0)).toBe('');
    expect(hiddenWorkNoteText(1, 0)).toBe('1 task hidden');
    expect(hiddenWorkNoteText(3, 2)).toBe('3 tasks · 2 tickets hidden');
  });
});
