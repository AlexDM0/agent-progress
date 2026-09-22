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
    slices: EXAMPLE_SLICES,
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

    expect(markup).toContain('<div><b>start</b><span>2026-09-18 20:36</span></div>');
    expect(markup).toContain('<div><b>end</b><span>2026-09-18 21:26</span></div>');
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
    expect(markup).toContain('<li data-state="running"><span class="ap-pill">wip</span><time>2026-09-18 20:36</time></li>');
    expect(markup, 'the first phase follows nothing, so it carries no gap').not.toContain('<time>2026-09-18 20:36</time><span class="ap-detail-gap">');
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

  test('says there is nothing to derive rather than showing an empty list', () => {
    const markup = panelFor(exampleTask({ status: 'pending', start: null }));

    expect(markup).toContain('its stamps carry nothing to derive them from');
    expect(markup).not.toContain('ap-detail-phases');
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
    expect(markup).toContain('<div><b>filed</b><span>2026-09-18 20:26</span></div>');
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
    { at: FINISHED_AT, text: '#1 finished, 18.4k tokens' },
    { at: DELIVERED_AT, text: 'Ticket #001 delivered' },
  ];

  test('keeps the lines that name this row or its ticket, newest first', () => {
    const lines = [...panelFor(exampleTask({ id: 1, ticket: '001' }), exampleTicket(), log).matchAll(/<span>([^<]*)<\/span><\/li>/g)].map((match) => match[1]);

    expect(lines).toEqual(['Ticket #001 delivered', '#1 finished, 18.4k tokens', 'Ticket #001 filed: Double-click a role to edit it']);
  });

  // The reason the match is bounded: `#1` is a prefix of `#13`, and task 1 would otherwise claim task 13's whole history.
  test('does not let a row claim a line about a row whose number merely starts with its own', () => {
    const markup = panelFor(exampleTask({ id: 1 }), null, [{ at: FINISHED_AT, text: '#13 finished' }]);

    expect(markup).not.toContain('#13 finished');
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

  // A backfilled `--at` can put a later phase earlier; a negative span reads as the shortest one rather than as "-3m".
  test('names a span that runs backwards as the shortest one there is', () => {
    expect(formatDuration(-180_000)).toBe('under a minute');
  });
});
