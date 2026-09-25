/**
 * The overview panel, whose load-bearing cases are the ones a reader would otherwise be misled by: a row whose phases were
 * recorded against one whose phases can only be derived, the rounds a repeat review is counted in, which log lines are
 * claimed as this row's, and that everything but a ticket body is escaped.
 */

import { describe, expect, test } from 'bun:test';

import type { LogEntry, Task }              from '../constants/Types.ts';
import type { PageTicket }                  from './page/PageData.ts';
import type { TimestampSlices }             from './page/PageMarkup.ts';
import { formatDuration, taskDetailMarkup } from './page/TaskDetail.ts';

const EXAMPLE_SLICES: TimestampSlices = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

/** The example board's own day, so its stamps print as a clock with the full stamp on hover. */
const EXAMPLE_TODAY = '2026-09-18';

const FILED_AT     = '2026-09-18T20:26:00+02:00';
const STARTED_AT   = '2026-09-18T20:36:00+02:00';
const FINISHED_AT  = '2026-09-18T21:26:00+02:00';
const REVIEWED_AT  = '2026-09-18T21:40:00+02:00';
const DELIVERED_AT = '2026-09-18T21:51:00+02:00';

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   'Double-click a role to edit it',
    status: 'running',
    start:  STARTED_AT,
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
    id:          '001',
    title:       'Double-click a role to edit it',
    type:        'change',
    status:      'in-progress',
    filed:       FILED_AT,
    updated:     STARTED_AT,
    started:     STARTED_AT,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    branch:      'ticket/role-editor',
    task:        1,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/001-role-editor.md',
    bodyHtml:    '<h2>Report</h2>',
    ...changes,
  };
}

function panelFor(task: Task | null, ticket: PageTicket | null = null, log: readonly LogEntry[] = []): string {
  return taskDetailMarkup({
    task,
    ticket,
    log,
    slices:            EXAMPLE_SLICES,
    todayCalendarDate: EXAMPLE_TODAY,
  });
}

function phaseLabelsIn(markup: string): string[] {
  const phases = /<ol class="ap-detail-phases">([\s\S]*?)<\/ol>/.exec(markup)?.[1] ?? '';
  return [...phases.matchAll(/<span class="ap-pill">([^<]*)<\/span>/g)].map((match) => match[1]!);
}

describe('the header', () => {
  test('names the row, its state in the ladder’s words, and the ticket it belongs to', () => {
    const markup = panelFor(exampleTask({ id: 7, status: 'delivered', ticket: '001' }), exampleTicket({ status: 'delivered' }));

    expect(markup).toContain('<div class="ap-detail-head" data-state="delivered">');
    expect(markup).toContain('<span class="ap-detail-id">#7</span>');
    expect(markup).toContain('<span class="ap-pill">done</span>');
    expect(markup).toContain('<a class="ap-ticket-badge" href="#ap-ticket-001">#001</a>');
  });

  // The one state a task status cannot name on its own, and the panel has to read it the same way the chart does.
  test('reads a finished row whose ticket is in review as reviewing, exactly as the chart does', () => {
    const markup = panelFor(exampleTask({ status: 'finished', ticket: '001' }), exampleTicket({ status: 'in-review' }));

    expect(markup).toContain('<div class="ap-detail-head" data-state="reviewing">');
    expect(markup).toContain('<span class="ap-pill">reviewing</span>');
  });

  test('opens on the ticket alone when its row has been removed, and on nothing at all when neither is there', () => {
    const markup = panelFor(null, exampleTicket());

    expect(markup).toContain('<span class="ap-detail-id">#001</span>');
    expect(markup).not.toContain('ap-detail-phases');
    expect(panelFor(null, null)).toBe('');
  });
});

describe('the task facts', () => {
  test('gives the span between the two stamps as a duration, since a span has no wall clock to preserve', () => {
    const markup = panelFor(exampleTask({ end: FINISHED_AT, tokens: 18_400 }));

    expect(markup).toContain('<div><b>start</b><span title="2026-09-18 20:36">20:36</span></div>');
    expect(markup).toContain('<div><b>end</b><span title="2026-09-18 21:26">21:26</span></div>');
    expect(markup).toContain('<div><b>elapsed</b><span>50m</span></div>');
    expect(markup).toContain('<div><b>tokens</b><span>18.4k</span></div>');
  });

  test('leaves out what the row never recorded, rather than printing an empty fact', () => {
    const markup = panelFor(exampleTask({ owner: '', start: null }));

    expect(markup).not.toContain('<b>owner</b>');
    expect(markup).not.toContain('<b>start</b>');
    expect(markup).not.toContain('<b>elapsed</b>');
    expect(markup).not.toContain('<b>tokens</b>');
    expect(markup).not.toContain('<b>review round</b>');
  });

  test('carries the review round a repeat review left on the row', () => {
    expect(panelFor(exampleTask({ status: 're-review', reviewRound: 3 }))).toContain('<div><b>review round</b><span>3</span></div>');
  });

  // A dispatcher's claim note is on the row and nowhere else on the page, so the panel is where a reader finds it.
  test('shows the row’s note as a fact, escaped', () => {
    const markup = panelFor(exampleTask({ note: 'Built by <b>the</b> dispatcher & co' }));

    expect(markup).toContain('<div><b>note</b><span>Built by &lt;b&gt;the&lt;/b&gt; dispatcher &amp; co</span></div>');
    expect(panelFor(exampleTask({ note: '' }))).not.toContain('<b>note</b>');
  });

  // A row whose end was backfilled before its start has no elapsed time, and "under a minute" would read as a real one.
  test('shows no elapsed time for a row whose end is before its start', () => {
    const markup = panelFor(exampleTask({ start: FINISHED_AT, end: STARTED_AT }));

    expect(markup).toContain('<b>end</b>');
    expect(markup).not.toContain('<b>elapsed</b>');
    expect(markup).not.toContain('under a minute');
  });
});

describe('the phases', () => {
  test('lists a recorded history oldest first, in the pills the chart uses, with the time spent in the phase before', () => {
    const markup = panelFor(exampleTask({
      status:  'reviewed',
      end:     FINISHED_AT,
      history: [
        { status: 'running', at: STARTED_AT },
        { status: 'finished', at: FINISHED_AT },
        { status: 'reviewed', at: REVIEWED_AT },
      ],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['wip', 'awaiting review', 'awaiting merge']);
    expect(markup).toContain('<li data-state="running"><span class="ap-pill">wip</span><time title="2026-09-18 20:36">20:36</time></li>');
    expect(markup, 'the first phase follows nothing, so it carries no gap').not.toContain('20:36</time><span class="ap-detail-gap">');
    expect(markup).toContain('<span class="ap-detail-gap">after 50m</span>');
    expect(markup).toContain('<span class="ap-detail-gap">after 14m</span>');
    expect(markup, 'a recorded history is not announced as a derivation').not.toContain('were not recorded');
  });

  // Each round is a phase of its own on a row that never changes status, so the number has to be counted off the list.
  test('numbers each recorded review round from the second upwards', () => {
    const markup = panelFor(exampleTask({
      status:  're-review',
      history: [
        { status: 'finished', at: FINISHED_AT },
        { status: 're-review', at: REVIEWED_AT },
        { status: 're-review', at: DELIVERED_AT },
      ],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['awaiting review', 'reviewing 2', 'reviewing 3']);
  });

  // Reading the newest phase the way the chart reads the row is the whole reason the panel is handed the ticket.
  test('reads the newest phase of a finished row through its ticket, recorded or derived', () => {
    const recorded = panelFor(
      exampleTask({ status: 'finished', history: [{ status: 'running', at: STARTED_AT }, { status: 'finished', at: FINISHED_AT }] }),
      exampleTicket({ status: 'in-review' }),
    );
    const derived = panelFor(exampleTask({ status: 'finished', end: FINISHED_AT, ticket: '001' }), exampleTicket({ status: 'in-review' }));

    expect(phaseLabelsIn(recorded)).toEqual(['wip', 'reviewing']);
    expect(phaseLabelsIn(derived)).toEqual(['unstarted', 'wip', 'reviewing']);
  });

  // An older phase keeps what it was filed under: only the newest one is still the row's own state.
  test('leaves an older finished phase reading awaiting review although the ticket is now in review', () => {
    const markup = panelFor(
      exampleTask({
        status:  're-review',
        history: [{ status: 'finished', at: FINISHED_AT }, { status: 're-review', at: REVIEWED_AT }],
      }),
      exampleTicket({ status: 'in-review' }),
    );

    expect(phaseLabelsIn(markup)).toEqual(['awaiting review', 'reviewing 2']);
  });

  test('says plainly that a row filed before the field existed had no phases recorded, and derives them from the stamps', () => {
    const markup = panelFor(
      exampleTask({
        id:       1,
        status:   'delivered',
        ticket:   '001',
        end:      FINISHED_AT,
        reviewed: REVIEWED_AT,
      }),
      exampleTicket({ status: 'delivered', finished: FINISHED_AT, delivered: DELIVERED_AT }),
    );

    expect(markup).toContain('<p class="ap-detail-note">The phases of this row were not recorded');
    expect(phaseLabelsIn(markup)).toEqual(['unstarted', 'wip', 'awaiting review', 'awaiting merge', 'done']);
  });

  // A derivation may not invent a phase the row never reached: a running row has not been reviewed, whatever its ticket carries.
  test('derives no phase past the one the row is in', () => {
    const markup = panelFor(exampleTask({ status: 'running', ticket: '001' }), exampleTicket({ finished: FINISHED_AT, delivered: DELIVERED_AT }));

    expect(phaseLabelsIn(markup)).toEqual(['unstarted', 'wip']);
  });

  /**
   * An abandoned row's `end` is the moment it was abandoned — `transitionTask` stamps it there — so reading it as a
   * finish would claim a review that never happened, and at the very instant the row was called off.
   */
  test('reads an abandoned row’s end as the abandonment and not as a review it never had', () => {
    const withoutTicket = panelFor(exampleTask({ status: 'abandoned', end: FINISHED_AT }));
    const withTicket    = panelFor(
      exampleTask({ status: 'abandoned', end: FINISHED_AT, ticket: '001' }),
      exampleTicket({ status: 'abandoned', abandonedAt: DELIVERED_AT }),
    );

    expect(phaseLabelsIn(withoutTicket)).toEqual(['wip', 'abandoned']);
    expect(phaseLabelsIn(withTicket)).toEqual(['unstarted', 'wip', 'abandoned']);
  });

  // The ticket's own `finished` stamp is evidence the row really was in review before it was called off; the row's `end` is not.
  test('derives the review of a row abandoned out of review from the ticket’s finished stamp', () => {
    const markup = panelFor(
      exampleTask({ status: 'abandoned', end: DELIVERED_AT, ticket: '001' }),
      exampleTicket({ status: 'abandoned', finished: FINISHED_AT, abandonedAt: DELIVERED_AT }),
    );

    expect(phaseLabelsIn(markup)).toEqual(['unstarted', 'wip', 'awaiting review', 'abandoned']);
  });

  // `transitionTask` drops `reviewRound` when a row goes back to pending, so a panel counting every round in the list would outrun the pill.
  test('restarts the review rounds after the row was sent back to pending', () => {
    const markup = panelFor(exampleTask({
      status:  're-review',
      history: [
        { status: 'finished', at: FILED_AT },
        { status: 're-review', at: STARTED_AT },
        { status: 'pending', at: FINISHED_AT },
        { status: 'running', at: REVIEWED_AT },
        { status: 'finished', at: DELIVERED_AT },
        { status: 're-review', at: '2026-09-18T22:10:00+02:00' },
      ],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['awaiting review', 'reviewing 2', 'unstarted', 'wip', 'awaiting review', 'reviewing 2']);
  });

  test('gives no gap to a phase stamped before the one it follows', () => {
    const markup = panelFor(exampleTask({
      status:  'finished',
      history: [{ status: 'running', at: FINISHED_AT }, { status: 'finished', at: STARTED_AT }],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['wip', 'awaiting review']);
    expect(markup).not.toContain('ap-detail-gap');
  });

  test('says there is nothing to derive rather than showing an empty list', () => {
    const markup = panelFor(exampleTask({ status: 'pending', start: null }));

    expect(markup).toContain('its stamps carry nothing to derive them from');
    expect(markup).not.toContain('ap-detail-phases');
  });
});

// Every stamp in the panel follows the page's one rule, so a stamp from yesterday cannot read as today's clock.
describe('the stamps against the viewer\'s day', () => {
  test('dates a stamp from another day in the facts, the phases and the log, and shows one from another year in full with no title', () => {
    const yesterday = '2026-09-17T23:48:00+02:00';
    const lastYear  = '2025-12-31T23:48:00+01:00';
    const markup    = panelFor(
      exampleTask({
        status:  'running',
        ticket:  '001',
        start:   yesterday,
        history: [{ status: 'running', at: yesterday }],
      }),
      exampleTicket({ filed: lastYear, started: yesterday }),
      [{ at: yesterday, text: 'Ticket #001 started' }],
    );

    expect(markup).toContain('<div><b>start</b><span title="2026-09-17 23:48">09-17 23:48</span></div>');
    expect(markup).toContain('<span class="ap-pill">wip</span><time title="2026-09-17 23:48">09-17 23:48</time>');
    expect(markup).toContain('<div><b>filed</b><span>2025-12-31 23:48</span></div>');
    expect(markup).toContain('<li><time title="2026-09-17 23:48">09-17 23:48</time><span>Ticket #001 started</span></li>');
  });
});

describe('the ticket', () => {
  test('carries the ticket’s own facts, including the ones the chart never shows', () => {
    const markup = panelFor(exampleTask({ ticket: '001' }), exampleTicket({
      group:     'role-editor',
      commit:    'abc1234',
      dependsOn: ['002', '003'],
    }));

    expect(markup).toContain('<span class="ap-badge in-progress">in-progress</span>');
    expect(markup).toContain('<span class="ap-detail-type">change</span>');
    expect(markup).toContain('<div><b>group</b><span>role-editor</span></div>');
    expect(markup).toContain('<div><b>commit</b><span>abc1234</span></div>');
    expect(markup).toContain('<div><b>filed</b><span title="2026-09-18 20:26">20:26</span></div>');
    expect(markup).toContain('<div><b>waits on</b><span><a href="#ap-ticket-002">#002</a>, <a href="#ap-ticket-003">#003</a></span></div>');
  });

  test('places the pre-rendered body verbatim, because it is the one string already escaped elsewhere', () => {
    expect(panelFor(exampleTask(), exampleTicket({ bodyHtml: '<h2>Report</h2><p>one</p>' })))
      .toContain('<div class="ap-ticket-body md"><h2>Report</h2><p>one</p></div>');
  });

  test('escapes a hostile title and a hostile reason', () => {
    const markup = panelFor(exampleTask({ name: '<img src=x>' }), exampleTicket({ title: '<b>bold</b>', reason: '</script><b>x</b>' }));

    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<b>bold</b>');
    expect(markup).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(markup).toContain('&lt;/script&gt;');
  });
});

describe('the log', () => {
  const log: LogEntry[] = [
    { at: FILED_AT, text: 'Ticket #001 filed: Double-click a role to edit it' },
    { at: STARTED_AT, text: 'Ticket #002 started' },
    { at: FINISHED_AT, text: 'Review row #1 started: Review 1 #001 — Double-click a role to edit it' },
    { at: DELIVERED_AT, text: 'Ticket #001 delivered' },
  ];

  function logLinesIn(markup: string): Array<string | undefined> {
    return [...markup.matchAll(/<span>([^<]*)<\/span><\/li>/g)].map((match) => match[1]);
  }

  test('keeps the lines that name this row or its ticket, newest first', () => {
    const lines = logLinesIn(panelFor(exampleTask({ id: 1, ticket: '001' }), exampleTicket(), log));

    expect(lines).toEqual([
      'Ticket #001 delivered',
      'Review row #1 started: Review 1 #001 — Double-click a role to edit it',
      'Ticket #001 filed: Double-click a role to edit it',
    ]);
  });

  // The reason the match is bounded: `#1` is a prefix of `#13`, and task 1 would otherwise claim task 13's whole history.
  test('does not let a row claim a line about a row whose number merely starts with its own', () => {
    const markup = panelFor(exampleTask({ id: 1 }), null, [{ at: FINISHED_AT, text: 'Task #13 finished' }]);

    expect(markup).not.toContain('Task #13 finished');
  });

  /**
   * Ticket ids are padded to three digits, so from ticket #100 up a ticket's `#120` is spelled exactly as task 120's: a row is
   * matched only in the forms written for rows, and a line that begins as a ticket's names no row.
   */
  test('never lets a row claim a ticket’s line from ticket #100 up, while it keeps the lines written for rows', () => {
    const lines = logLinesIn(panelFor(exampleTask({ id: 120 }), null, [
      { at: FILED_AT, text: 'Ticket #120 started' },
      { at: STARTED_AT, text: 'Ticket #121 filed: Show task #120 in the panel' },
      { at: FINISHED_AT, text: 'Task #120 finished' },
      { at: REVIEWED_AT, text: 'Review row #120 started: Review 1 #007 — Example' },
      { at: DELIVERED_AT, text: 'Closed the review row #120, delivered: Review 1 #007 — Example' },
    ]));

    expect(lines).toEqual([
      'Closed the review row #120, delivered: Review 1 #007 — Example',
      'Review row #120 started: Review 1 #007 — Example',
      'Task #120 finished',
    ]);
  });

  // The same collision the other way round: ticket 120's panel may not claim the lines written about row 120.
  test('never lets a ticket claim the lines written for a row of the same number', () => {
    const lines = logLinesIn(panelFor(null, exampleTicket({ id: '120', task: 7 }), [
      { at: FILED_AT, text: 'Ticket #120 filed: Example' },
      { at: STARTED_AT, text: 'Task #120 finished' },
      { at: FINISHED_AT, text: 'Review row #120 started: Review 1 #007 — Example' },
      { at: REVIEWED_AT, text: 'Review row #9 started: Review 1 #120 — Example' },
    ]));

    expect(lines).toEqual(['Review row #9 started: Review 1 #120 — Example', 'Ticket #120 filed: Example']);
  });

  // Phases says so in words when it has nothing; a labelled empty box beside it would read as a section that failed to load.
  test('says no line names this row rather than showing an empty box', () => {
    const markup = panelFor(exampleTask({ id: 1 }), null, [{ at: FINISHED_AT, text: '#13 finished' }]);

    expect(markup).not.toContain('<ul class="ap-detail-log"></ul>');
    expect(markup).toContain('No log line names this row');
  });
});

describe('formatDuration', () => {
  test.each<[number, string]>([
    [0, 'under a minute'],
    [30_000, 'under a minute'],
    [60_000, '1m'],
    [45 * 60_000, '45m'],
    [60 * 60_000, '1h'],
    [135 * 60_000, '2h 15m'],
    [26 * 60 * 60_000, '1d 2h'],
    [48 * 60 * 60_000, '2d'],
  ])('reads %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  // A backfilled `--at` can put a later phase earlier; a negative span is no duration at all, neither "-3m" nor "under a minute".
  test('names no duration for a span that runs backwards', () => {
    expect(formatDuration(-180_000)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});
