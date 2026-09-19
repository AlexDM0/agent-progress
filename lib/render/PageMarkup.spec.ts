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

function rowFor(task: Task, ticketStatus: TicketStatus | null = null, bar: TimelineBar = PLACED_BAR): string {
  return taskRowsMarkup([{ task, ticketStatus, bar }]);
}

describe('taskRowsMarkup', () => {
  test('draws the most recently filed task on top', () => {
    const markup = taskRowsMarkup([1, 2, 3].map((id) => ({ task: exampleTask({ id }), ticketStatus: null, bar: PLACED_BAR })));

    expect([...markup.matchAll(/data-task-id="(\d+)"/g)].map((match) => match[1])).toEqual(['3', '2', '1']);
  });

  test.each<[TaskStatus, string]>([
    ['pending', 'WIP'],
    ['running', 'WIP'],
    ['paused', 'paused'],
    ['finished', 'finished'],
    ['reviewed', 'reviewed'],
    ['delivered', 'delivered'],
    ['abandoned', 'abandoned'],
  ])('gives a %s row exactly one pill reading %s', (status, label) => {
    const markup = rowFor(exampleTask({ status }));

    expect(markup).toContain(`data-state="${status}"`);
    expect(markup).toContain(`<div class="ap-cell-pill"><span class="ap-pill">${label}</span></div>`);
    expect(markup.match(/ap-pill/g)?.length).toBe(1);
  });

  test('gives a reviewing row the reviewing state and label', () => {
    const markup = rowFor(exampleTask({ status: 'finished' }), 'in-review');

    expect(markup).toContain('data-state="reviewing"');
    expect(markup).toContain('<span class="ap-pill">reviewing</span>');
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

describe('summaryStatsMarkup', () => {
  test('counts finished, reviewed and delivered cumulatively', () => {
    const markup = summaryStatsMarkup([
      exampleTask({ id: 1, status: 'pending' }),
      exampleTask({ id: 2, status: 'finished' }),
      exampleTask({ id: 3, status: 'reviewed' }),
      exampleTask({ id: 4, status: 'delivered' }),
    ]);

    expect(markup).toContain('<span class="ap-stat-n">3/4</span> finished');
    expect(markup).toContain('<span class="ap-stat-n">2</span> reviewed');
    expect(markup).toContain('<span class="ap-stat-n">1</span> delivered');
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
    const markup = ticketTableRowsMarkup([exampleTicket()]);

    expect(markup).toContain('<a href="#ap-ticket-003">#003</a>');
    expect(markup).toContain('<a href="#ap-task-3">#3</a>');
    expect(markup).toContain('<span class="ap-badge in-review">in-review</span>');
    expect(markup).toContain('ticket/exporter-passes');
  });

  test('leaves the task cell empty for a ticket with no row yet', () => {
    expect(ticketTableRowsMarkup([exampleTicket({ task: null })])).toContain('<td class="mono"></td></tr>');
  });

  test('escapes a hostile ticket title', () => {
    expect(ticketTableRowsMarkup([exampleTicket({ title: '<b>bold</b>' })])).toContain('&lt;b&gt;bold&lt;/b&gt;');
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
  test.each<[TicketStatus]>([['open'], ['in-progress'], ['in-review']])('leaves a %s card open, with no disclosure', (status) => {
    const markup = ticketCardsMarkup([exampleTicket({ status })], EXAMPLE_SLICES);

    expect(markup).toContain('<div class="ap-ticket-head">');
    expect(markup).not.toContain('<details>');
  });

  test.each<[TicketStatus]>([['done'], ['delivered'], ['abandoned']])('collapses a %s card into a disclosure', (status) => {
    const markup = ticketCardsMarkup([exampleTicket({ status })], EXAMPLE_SLICES);

    expect(markup).toContain('<details><summary>');
    expect(markup).not.toContain('ap-ticket-head');
  });

  test('keeps the id on the outer section either way', () => {
    expect(ticketCardsMarkup([exampleTicket({ status: 'open' })], EXAMPLE_SLICES)).toContain('<section class="ap-ticket" id="ap-ticket-003">');
    expect(ticketCardsMarkup([exampleTicket({ status: 'done' })], EXAMPLE_SLICES)).toContain('<section class="ap-ticket" id="ap-ticket-003">');
  });

  test('shows the latest milestone the ticket reached, not the first', () => {
    const delivered = ticketCardsMarkup([exampleTicket({ status: 'delivered', delivered: '2026-09-18T21:51:00+02:00' })], EXAMPLE_SLICES);
    const filedOnly = ticketCardsMarkup([exampleTicket({ started: null, finished: null })], EXAMPLE_SLICES);

    expect(delivered).toContain('<span class="ap-ticket-dates">delivered 21:51</span>');
    expect(filedOnly).toContain('<span class="ap-ticket-dates">filed 20:44</span>');
  });

  test('shortens the timestamps in the meta list and leaves the branch whole', () => {
    const markup = ticketCardsMarkup([exampleTicket({ commit: '4f1e9c0abcdef' })], EXAMPLE_SLICES);

    expect(markup).toContain('<div><b>filed</b><span>2026-09-18 20:44</span></div>');
    expect(markup).toContain('<div><b>branch</b><span>ticket/exporter-passes</span></div>');
    expect(markup).toContain('<div><b>commit</b><span>4f1e9c0abcdef</span></div>');
  });

  test('leaves out the meta entries the ticket never recorded', () => {
    const markup = ticketCardsMarkup([exampleTicket({ started: null, finished: null })], EXAMPLE_SLICES);

    expect(markup).not.toContain('<b>started</b>');
    expect(markup).not.toContain('<b>finished</b>');
  });

  test('places the pre-rendered body verbatim inside the markdown container', () => {
    const markup = ticketCardsMarkup([exampleTicket({ bodyHtml: '<h2>Report</h2><p>one</p>' })], EXAMPLE_SLICES);

    expect(markup).toContain('<div class="ap-ticket-body md"><h2>Report</h2><p>one</p></div>');
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
