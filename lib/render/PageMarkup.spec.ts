/**
 * The markup the page emits into `lib/render/page/template.html`, with every tracker value escaped exactly once.
 */

import { describe, expect, test } from 'bun:test';
import type {
  LogEntry,
  Task,
  TaskStatus,
  TicketStatus,
} from '../constants/Types.ts';
import type { TimelineBar }     from './page/GanttGeometry.ts';
import type { PageTicket }      from './page/PageData.ts';
import type { TimestampSlices } from './page/PageMarkup.ts';
import {
  axisPixelsNeededFor,
  labelSitsLeftOfItsLine,
  logItemsMarkup,
  overlayMarkup,
  rangeNoteText,
  summaryStatsMarkup,
  taskRowsMarkup,
  ticketCardsMarkup,
  ticketCountText,
  ticketTableRowsMarkup,
  tickLayerMarkup,
} from './page/PageMarkup.ts';

const EXAMPLE_SLICES: TimestampSlices = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

const EXAMPLE_RANGE_LIMITS = {
  hourMinutes:                60,
  dayMinutes:                 1440,
  hoursAxisLabelLimitMinutes: 1440,
};

const NO_WAITING = new Map<string, string[]>();

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
    status: 'running',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id:          '003',
    title:       'Split the exporter into two passes',
    type:        'change',
    status:      'in-review',
    filed:       '2026-09-18T20:44:00+02:00',
    updated:     '2026-09-18T21:49:00+02:00',
    started:     '2026-09-18T21:02:00+02:00',
    finished:    '2026-09-18T21:49:00+02:00',
    delivered:   null,
    abandonedAt: null,
    branch:      'ticket/exporter-passes',
    task:        3,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/003-exporter.md',
    bodyHtml:    '<h2>Report</h2>',
    ...changes,
  };
}

function rowFor(task: Task, ticketStatus: TicketStatus | null = null, bar: TimelineBar = PLACED_BAR, waitingOn: readonly string[] = []): string {
  return taskRowsMarkup([{
    task,
    ticketStatus,
    bar,
    waitingOn,
  }], EXAMPLE_SLICES);
}

describe('taskRowsMarkup', () => {
  test('draws the most recently filed task on top', () => {
    const markup = taskRowsMarkup([1, 2, 3].map((id) => ({
      task: exampleTask({ id }), ticketStatus: null, bar: PLACED_BAR, waitingOn: [] 
    })), EXAMPLE_SLICES);

    expect([...markup.matchAll(/data-task-id="(\d+)"/g)].map((match) => match[1])).toEqual(['3', '2', '1']);
  });

  // The ladder the chart is read by: every label names the state the row is in, and `done` means merged.
  test.each<[TaskStatus, string]>([
    ['pending', 'unstarted'],
    ['running', 'wip'],
    ['paused', 'paused'],
    ['finished', 'awaiting review'],
    ['re-review', 'reviewing 2'],
    ['reviewed', 'awaiting merge'],
    ['delivered', 'done'],
    ['abandoned', 'abandoned'],
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

  test('leaves the mark off a row delivered straight from finished, and off a reviewed row that is not delivered yet', () => {
    expect(rowFor(exampleTask({ status: 'delivered' }))).not.toContain('ap-reviewed-mark');
    expect(rowFor(exampleTask({ status: 'reviewed', reviewed: '2026-09-18T21:10:00+02:00' }))).not.toContain('ap-reviewed-mark');
  });

  // Rows written before the stamp existed: delivery of a ticket is only legal from `done`.
  test('marks a delivered ticket row as reviewed even when it carries no stamp', () => {
    expect(rowFor(exampleTask({ status: 'delivered', ticket: '003' }), 'delivered')).toContain('ap-reviewed-mark');
  });

  test('says which tickets a row is waiting on, each linked to its card', () => {
    const markup = rowFor(exampleTask({ status: 'pending', ticket: '005' }), 'open', PLACED_BAR, ['003', '004']);

    expect(markup).toContain('<span class="ap-waiting">waiting on <a href="#ap-ticket-003">#003</a>, <a href="#ap-ticket-004">#004</a></span>');
  });

  test('writes no waiting note on a row that waits on nothing', () => {
    expect(rowFor(exampleTask())).not.toContain('ap-waiting');
  });

  test('gives a reviewing row the reviewing state and label', () => {
    const markup = rowFor(exampleTask({ status: 'finished' }), 'in-review');

    expect(markup).toContain('data-state="reviewing"');
    expect(markup).toContain('<span class="ap-pill">reviewing</span>');
  });

  test('numbers the pill of a row that is on its third review pass', () => {
    const markup = rowFor(exampleTask({ status: 're-review', reviewRound: 3 }), 'in-review');

    expect(markup).toContain('data-state="re-review"');
    expect(markup).toContain('<span class="ap-pill">reviewing 3</span>');
  });

  // A row moved by hand to the repeat state has no round on it; the state itself says it is at least the second pass.
  test('reads a repeat review with no round recorded as the second pass', () => {
    expect(rowFor(exampleTask({ status: 're-review' }))).toContain('<span class="ap-pill">reviewing 2</span>');
  });

  test('leaves every other status alone whatever its ticket says', () => {
    expect(rowFor(exampleTask({ status: 'running' }), 'in-review')).toContain('data-state="running"');
    expect(rowFor(exampleTask({ status: 'finished' }), 'done')).toContain('data-state="finished"');
  });

  test('carries the ids the ticket table and the fragment contract link to', () => {
    const markup = rowFor(exampleTask({ id: 7, ticket: '003' }));

    expect(markup).toContain('id="ap-task-7"');
    expect(markup).toContain('data-task-id="7"');
    expect(markup).toContain('<a class="ap-ticket-badge" href="#ap-ticket-003">#003</a>');
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
  return tasks.map((task) => ({
    task, ticketStatus: null, bar: PLACED_BAR, waitingOn: []
  }));
}

function drawnOrderOf(markup: string): Array<[taskId: string, reviewOf: string | null]> {
  return [...markup.matchAll(/data-task-id="(\d+)" data-state="[^"]+"(?: data-review-of="(\d+)")?/g)].map((match) => [match[1] ?? '', match[2] ?? null]);
}

// A review pass belongs to its ticket: it is drawn under the ticket's own row rather than wherever its start time put it.
describe('review rows nested under their ticket', () => {
  test('draws both review rows directly under the ticket, indented, round 1 above round 2, whether linked by flag or only by name', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, name: 'Split the exporter', ticket: '003' }),
      exampleTask({ id: 2, name: 'Regenerate the fixtures' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — Split the exporter' }),
      exampleTask({ id: 4, name: 'Brighter colours', ticket: '004' }),
      exampleTask({ id: 5, name: 'Review 2 #3 — Split the exporter', reviewOf: '003' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([
      ['4', null],
      ['2', null],
      ['1', null],
      ['3', '003'],
      ['5', '003'],
    ]);
  });

  test('puts the flag ahead of the name, so a review named for one ticket but filed against another nests under the flagged one', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, ticket: '004' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — x', reviewOf: '004' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['3', '004'], ['1', null]]);
  });

  test('draws a bundle review once, under the first ticket it names', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '005' }),
      exampleTask({ id: 2, ticket: '013' }),
      exampleTask({ id: 3, name: 'Review 1 #13, #5 — the bundle' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['3', '013'], ['1', null]]);
    expect(markup.match(/data-task-id="3"/g)?.length).toBe(1);
  });

  // A ticket not started, or hidden as long done, has no row here; its review must neither vanish nor move.
  test('leaves a review whose ticket has no row, and a free-standing row, where the filing order puts them, without an indent', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, name: 'Regenerate the fixtures' }),
      exampleTask({ id: 2, name: 'Review 1 #7 — a ticket with no row' }),
      exampleTask({ id: 3, name: 'Review pass of the whole surface' }),
      exampleTask({ id: 4, name: 'Review 1 #8 — linked by flag', reviewOf: '008' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['4', null], ['3', null], ['2', null], ['1', null]]);
    expect(markup).not.toContain('data-review-of');
  });

  test('never nests a ticket\'s own row, even one whose name reads like a review', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '003' }),
      exampleTask({ id: 2, name: 'Review 1 #3 — misnamed', ticket: '009' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['1', null]]);
  });
});

describe('summaryStatsMarkup', () => {
  // Work completed is the settled rows over the total, and the two figures beside it are what is still owed: a merge, and a review.
  test('reads in the same ladder as the pills: work completed out of the total, then what is awaited', () => {
    const markup = summaryStatsMarkup([
      exampleTask({ id: 1, status: 'pending' }),
      exampleTask({ id: 2, status: 'finished' }),
      exampleTask({ id: 3, status: 'reviewed' }),
      exampleTask({ id: 4, status: 'delivered' }),
    ]);

    expect(markup).toContain('Work completed: <span class="ap-stat-n">1 / 4</span>');
    expect(markup).toContain('<span class="ap-stat-n">1</span> awaiting merge');
    expect(markup).toContain('<span class="ap-stat-n">1</span> in review');
  });

  // An abandoned row has nothing left to do, so a board of only delivered and abandoned rows must not read as unfinished.
  test('counts an abandoned row as completed, so a settled board reads its total over its total', () => {
    const inFlight = summaryStatsMarkup([
      exampleTask({ id: 1, status: 'delivered' }),
      exampleTask({ id: 2, status: 'delivered' }),
      exampleTask({ id: 3, status: 'abandoned' }),
      exampleTask({ id: 4, status: 'running' }),
    ]);
    const settled = summaryStatsMarkup([
      exampleTask({ id: 1, status: 'delivered' }),
      exampleTask({ id: 2, status: 'abandoned' }),
      exampleTask({ id: 3, status: 'abandoned' }),
    ]);

    expect(inFlight).toContain('<span class="ap-stat">Work completed: <span class="ap-stat-n">3 / 4</span></span>');
    expect(settled).toContain('Work completed: <span class="ap-stat-n">3 / 3</span>');
  });

  // A delivered row is completed and nothing else: it is not still awaiting the merge it already had.
  test('counts a row sent round for another review as in review, and a delivered row only as completed', () => {
    const markup = summaryStatsMarkup([
      exampleTask({ id: 1, status: 're-review', reviewRound: 3 }),
      exampleTask({ id: 2, status: 'reviewed' }),
      exampleTask({ id: 3, status: 'delivered' }),
    ]);

    expect(markup).toContain('Work completed: <span class="ap-stat-n">1 / 3</span>');
    expect(markup).toContain('<span class="ap-stat-n">1</span> awaiting merge');
    expect(markup).toContain('<span class="ap-stat-n">1</span> in review');
  });

  test('sums the reported token counts and omits the figure when none were reported', () => {
    const reported = summaryStatsMarkup([exampleTask({ tokens: 12_300 }), exampleTask({ id: 2, tokens: 50_100 })]);

    expect(reported).toContain('<span class="ap-stat-n">62.4k</span> tokens');
    expect(summaryStatsMarkup([exampleTask()])).not.toContain('tokens');
  });

  test('separates the stats with the design’s middot', () => {
    expect(summaryStatsMarkup([exampleTask()])).toContain('<span class="ap-sep">&middot;</span>');
  });
});

describe('logItemsMarkup', () => {
  const entries: LogEntry[] = [
    { at: '2026-09-18T20:36:00+02:00', text: 'Tracker created' },
    { at: '2026-09-18T21:56:00+02:00', text: 'Subagent started' },
    { at: '2026-09-18T21:21:00+02:00', text: 'Old idea abandoned' },
  ];

  test('puts the newest entry first however the store appended them', () => {
    const times = [...logItemsMarkup(entries, EXAMPLE_SLICES).matchAll(/<time>([^<]+)<\/time>/g)].map((match) => match[1]);

    expect(times).toEqual(['21:56', '21:21', '20:36']);
  });

  test('adds the date to every line once the log covers more than one calendar day', () => {
    const acrossMidnight = [...entries, { at: '2026-09-19T00:12:00+02:00', text: 'Still going' }];
    const times = [...logItemsMarkup(acrossMidnight, EXAMPLE_SLICES).matchAll(/<time>([^<]+)<\/time>/g)].map((match) => match[1]);

    expect(times).toEqual(['09-19 00:12', '09-18 21:56', '09-18 21:21', '09-18 20:36']);
  });

  test('escapes a log line that carries markup', () => {
    const markup = logItemsMarkup([{ at: '2026-09-18T20:36:00+02:00', text: '</script><b>x</b>' }], EXAMPLE_SLICES);

    expect(markup).not.toContain('<b>');
    expect(markup).toContain('&lt;/script&gt;');
  });
});

describe('ticketTableRowsMarkup', () => {
  test('links the id and the task, and badges the status', () => {
    const markup = ticketTableRowsMarkup([exampleTicket()], NO_WAITING);

    expect(markup).toContain('<a href="#ap-ticket-003">#003</a>');
    expect(markup).toContain('<a href="#ap-task-3">#3</a>');
    expect(markup).toContain('<span class="ap-badge in-review">in-review</span>');
    expect(markup).toContain('ticket/exporter-passes');
  });

  // The only thing on a ticket table row that says which ticket it is without parsing a link: the detail panel resolves it from here.
  test('names its ticket on the row itself', () => {
    expect(ticketTableRowsMarkup([exampleTicket()], NO_WAITING)).toContain('<tr data-ticket-id="003">');
  });

  test('leaves the task cell empty for a ticket with no row yet', () => {
    expect(ticketTableRowsMarkup([exampleTicket({ task: null })], NO_WAITING)).toContain('<td class="mono"></td></tr>');
  });

  test('puts the waiting note beside the title of a ticket that waits', () => {
    const waiting = new Map([['003', ['001']]]);

    expect(ticketTableRowsMarkup([exampleTicket()], waiting)).toContain('two passes<span class="ap-waiting">waiting on <a href="#ap-ticket-001">#001</a></span></td>');
  });

  test('escapes a hostile ticket title', () => {
    expect(ticketTableRowsMarkup([exampleTicket({ title: '<b>bold</b>' })], NO_WAITING)).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

describe('ticketCountText', () => {
  test.each([
    ['no tickets', []],
    ['1 ticket', [exampleTicket({ status: 'open' })]],
    ['2 tickets · 1 in progress', [exampleTicket({ status: 'open' }), exampleTicket({ id: '004', status: 'in-progress' })]],
  ])('reads %s', (expected, tickets) => {
    expect(ticketCountText(tickets as PageTicket[])).toBe(expected);
  });
});

describe('ticketCardsMarkup', () => {
  test('lists every dependency in the card, and heads a waiting card with what it still waits on', () => {
    const markup = ticketCardsMarkup([exampleTicket({ dependsOn: ['001', '002'] })], new Map([['003', ['002']]]), EXAMPLE_SLICES);

    expect(markup).toContain('<b>waits on</b><span><a href="#ap-ticket-001">#001</a>, <a href="#ap-ticket-002">#002</a></span>');
    expect(markup).toContain('<span class="ap-waiting">waiting on <a href="#ap-ticket-002">#002</a></span>');
  });

  test.each<[TicketStatus]>([['open'], ['in-progress'], ['in-review']])('leaves a %s card open, with no disclosure', (status) => {
    const markup = ticketCardsMarkup([exampleTicket({ status })], NO_WAITING, EXAMPLE_SLICES);

    expect(markup).toContain('<div class="ap-ticket-head">');
    expect(markup).not.toContain('<details>');
  });

  test.each<[TicketStatus]>([['done'], ['delivered'], ['abandoned']])('collapses a %s card into a disclosure', (status) => {
    const markup = ticketCardsMarkup([exampleTicket({ status })], NO_WAITING, EXAMPLE_SLICES);

    expect(markup).toContain('<details><summary>');
    expect(markup).not.toContain('ap-ticket-head');
  });

  test('keeps the id on the outer section either way', () => {
    expect(ticketCardsMarkup([exampleTicket({ status: 'open' })], NO_WAITING, EXAMPLE_SLICES)).toContain('<section class="ap-ticket" id="ap-ticket-003">');
    expect(ticketCardsMarkup([exampleTicket({ status: 'done' })], NO_WAITING, EXAMPLE_SLICES)).toContain('<section class="ap-ticket" id="ap-ticket-003">');
  });

  test('shows the latest milestone the ticket reached, not the first', () => {
    const delivered = ticketCardsMarkup([exampleTicket({ status: 'delivered', delivered: '2026-09-18T21:51:00+02:00' })], NO_WAITING, EXAMPLE_SLICES);
    const filedOnly = ticketCardsMarkup([exampleTicket({ started: null, finished: null })], NO_WAITING, EXAMPLE_SLICES);

    expect(delivered).toContain('<span class="ap-ticket-dates">delivered 21:51</span>');
    expect(filedOnly).toContain('<span class="ap-ticket-dates">filed 20:44</span>');
  });

  test('shortens the timestamps in the meta list and leaves the branch whole', () => {
    const markup = ticketCardsMarkup([exampleTicket({ commit: '4f1e9c0abcdef' })], NO_WAITING, EXAMPLE_SLICES);

    expect(markup).toContain('<div><b>filed</b><span>2026-09-18 20:44</span></div>');
    expect(markup).toContain('<div><b>branch</b><span>ticket/exporter-passes</span></div>');
    expect(markup).toContain('<div><b>commit</b><span>4f1e9c0abcdef</span></div>');
  });

  test('leaves out the meta entries the ticket never recorded', () => {
    const markup = ticketCardsMarkup([exampleTicket({ started: null, finished: null })], NO_WAITING, EXAMPLE_SLICES);

    expect(markup).not.toContain('<b>started</b>');
    expect(markup).not.toContain('<b>finished</b>');
  });

  test('places the pre-rendered body verbatim inside the markdown container', () => {
    const markup = ticketCardsMarkup([exampleTicket({ bodyHtml: '<h2>Report</h2><p>one</p>' })], NO_WAITING, EXAMPLE_SLICES);

    expect(markup).toContain('<div class="ap-ticket-body md"><h2>Report</h2><p>one</p></div>');
  });
});

// The template is designer-owned, so a priority borrows two marks it already styles; a new class here would render unstyled.
describe('the priority marks on the Tickets tab', () => {
  const LOW_MARK_OPENING  = '<span class="ap-ticket-badge" data-priority="low"';
  const HIGH_MARK_OPENING = '<span class="ap-waiting" data-priority="high"';

  test('marks a low ticket low, beside its title in the table and after its status in the card, with an empty task cell while it has no row', () => {
    const lowTicket = exampleTicket({ priority: 'low', status: 'open', task: null });
    const tableRow  = ticketTableRowsMarkup([lowTicket], NO_WAITING);
    const card      = ticketCardsMarkup([lowTicket], NO_WAITING, EXAMPLE_SLICES);

    expect(tableRow).toMatch(/two passes <span class="ap-ticket-badge" data-priority="low" title="[^"]+">low<\/span><\/td>/);
    expect(tableRow).toContain('<td class="mono"></td></tr>');
    expect(card).toMatch(/<span class="ap-badge open">open<\/span> <span class="ap-ticket-badge" data-priority="low" title="[^"]+">low<\/span>/);
    expect(card).not.toContain('<b>task</b>');
  });

  test('marks a high ticket high, in the table and in the card', () => {
    const highTicket = exampleTicket({ priority: 'high' });

    expect(ticketTableRowsMarkup([highTicket], NO_WAITING)).toMatch(/two passes<span class="ap-waiting" data-priority="high" title="[^"]+">high<\/span><\/td>/);
    expect(ticketCardsMarkup([highTicket], NO_WAITING, EXAMPLE_SLICES)).toContain(HIGH_MARK_OPENING);
  });

  test('leaves a normal ticket, and one whose file carries no priority, unmarked', () => {
    for (const ticket of [exampleTicket({ priority: 'normal' }), exampleTicket()]) {
      const markup = ticketTableRowsMarkup([ticket], NO_WAITING) + ticketCardsMarkup([ticket], NO_WAITING, EXAMPLE_SLICES);
      expect(markup).not.toContain('data-priority');
    }
    expect(ticketTableRowsMarkup([exampleTicket({ priority: 'low' })], NO_WAITING)).toContain(LOW_MARK_OPENING);
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

  test('asks for the label width per tick, with a floor for the short formats', () => {
    expect(axisPixelsNeededFor([{ leftPercent: 0, label: '20:30' }])).toBe(60);
    expect(axisPixelsNeededFor([{ leftPercent: 0, label: 'Thu 21:45' }])).toBe(81);
    expect(axisPixelsNeededFor([])).toBe(0);
  });

  test('moves a label to the left of its line only when the pixels run out', () => {
    expect(labelSitsLeftOfItsLine({ leftPercent: 98.97, label: '22:15' }, 900)).toBe(true);
    expect(labelSitsLeftOfItsLine({ leftPercent: 50, label: '22:15' }, 900)).toBe(false);
  });

  test('writes the tick step in the largest unit that divides it', () => {
    const from = Date.UTC(2026, 8, 18, 18, 30, 0);

    expect(rangeNoteText(from, from + 105 * 60_000, 15, EXAMPLE_RANGE_LIMITS)).toContain('· 15m ticks');
    expect(rangeNoteText(from, from + 105 * 60_000, 360, EXAMPLE_RANGE_LIMITS)).toContain('· 6h ticks');
    expect(rangeNoteText(from, from + 105 * 60_000, 1440, EXAMPLE_RANGE_LIMITS)).toContain('· 1d ticks');
  });

  test('adds the date to both ends once the range outgrows a day', () => {
    const from = Date.UTC(2026, 8, 18, 18, 30, 0);

    expect(rangeNoteText(from, from + 105 * 60_000, 15, EXAMPLE_RANGE_LIMITS)).not.toMatch(/\d\d-\d\d /);
    expect(rangeNoteText(from, from + 1440 * 60_000, 60, EXAMPLE_RANGE_LIMITS)).toMatch(/\d\d-\d\d \d\d:\d\d → \d\d-\d\d \d\d:\d\d/);
    expect(rangeNoteText(from, from + 7 * 1440 * 60_000, 1440, EXAMPLE_RANGE_LIMITS)).toMatch(/\d\d-\d\d \d\d:\d\d → \d\d-\d\d \d\d:\d\d/);
  });
});
