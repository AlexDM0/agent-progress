/**
 * The overview panel, whose load-bearing cases are the ones a reader would otherwise be misled by: a row whose phases were
 * recorded against one whose phases can only be derived, the rounds a repeat review is counted in, which log lines are
 * claimed as this row's, and that everything but a ticket body is escaped.
 */

import { describe, expect, test } from 'bun:test';

import type { Task }               from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';
import type { IdentifiedLogEntry } from '../../src/shared/@types/WordedLogEntry.ts';
import { pageBoardFixture }        from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }     from '../testing/PageLimitsFixture.ts';
import { taskDetailMarkup }        from './TaskDetail.ts';

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
    status: 'in-progress',
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

function panelFor(task: Task | null, ticket: PageTicket | null = null, log: readonly IdentifiedLogEntry[] = []): string {
  return taskDetailMarkup({
    task:              pageBoardFixture({ tasks: task === null ? [] : [task], tickets: ticket === null ? [] : [ticket] }).rows[0] ?? null,
    ticket,
    log,
    ticketEpics:       [],
    allTickets:        ticket === null ? [] : [ticket],
    slices:            EXAMPLE_PAGE_LIMITS,
    todayCalendarDate: EXAMPLE_TODAY,
  });
}

function phaseLabelsIn(markup: string): string[] {
  const phases = /<ol class="ap-detail-phases">([\s\S]*?)<\/ol>/.exec(markup)?.[1] ?? '';
  return [...phases.matchAll(/<span class="ap-pill">([^<]*)<\/span>/g)].map((match) => match[1] ?? '');
}

describe('the header', () => {
  test('names the row, its state in the ladder’s words, and the ticket it belongs to', () => {
    const markup = panelFor(exampleTask({ id: 7, status: 'delivered', ticket: '001' }), exampleTicket({ status: 'delivered' }));

    expect(markup).toContain('<div class="ap-detail-head" data-state="delivered">');
    expect(markup).toContain('<span class="ap-detail-id">#7</span>');
    expect(markup).toContain('<span class="ap-pill">Done</span>');
    expect(markup).toContain('<a class="ap-ticket-badge" href="#ap-ticket-001">#001</a>');
  });

  // The one state a task status cannot name on its own, and the panel has to read it the same way the chart does.
  test('reads an in-review row whose ticket is in review as reviewing, exactly as the chart does', () => {
    const markup = panelFor(exampleTask({ status: 'in-review', ticket: '001' }), exampleTicket({ status: 'in-review' }));

    expect(markup).toContain('<div class="ap-detail-head" data-state="reviewing">');
    expect(markup).toContain('<span class="ap-pill">Reviewing</span>');
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
        { status: 'in-progress', at: STARTED_AT },
        { status: 'in-review', at: FINISHED_AT },
        { status: 'reviewed', at: REVIEWED_AT },
      ],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['In progress', 'Awaiting review', 'Awaiting merge']);
    expect(markup).toContain('<li data-state="in-progress"><span class="ap-pill">In progress</span><time title="2026-09-18 20:36">20:36</time></li>');
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
        { status: 'in-review', at: FINISHED_AT },
        { status: 're-review', at: REVIEWED_AT },
        { status: 're-review', at: DELIVERED_AT },
      ],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['Awaiting review', 'Reviewing (round 2)', 'Reviewing (round 3)']);
  });

  // The newest phase takes the display state the Board facts give the row, which the ticket's own status decides here.
  test('reads the newest phase of an in-review row through its ticket, recorded or derived', () => {
    const recorded = panelFor(
      exampleTask({ status: 'in-review', ticket: '001', history: [{ status: 'in-progress', at: STARTED_AT }, { status: 'in-review', at: FINISHED_AT }] }),
      exampleTicket({ status: 'in-review' }),
    );
    const derived = panelFor(exampleTask({ status: 'in-review', end: FINISHED_AT, ticket: '001' }), exampleTicket({ status: 'in-review' }));

    expect(phaseLabelsIn(recorded)).toEqual(['In progress', 'Reviewing']);
    expect(phaseLabelsIn(derived)).toEqual(['To do', 'In progress', 'Reviewing']);
  });

  // An older phase keeps what it was filed under: only the newest one is still the row's own state.
  test('leaves an older in-review phase reading awaiting review although the ticket is now in review', () => {
    const markup = panelFor(
      exampleTask({
        status:  're-review',
        history: [{ status: 'in-review', at: FINISHED_AT }, { status: 're-review', at: REVIEWED_AT }],
      }),
      exampleTicket({ status: 'in-review' }),
    );

    expect(phaseLabelsIn(markup)).toEqual(['Awaiting review', 'Reviewing (round 2)']);
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
    expect(phaseLabelsIn(markup)).toEqual(['To do', 'In progress', 'Awaiting review', 'Awaiting merge', 'Done']);
    expect(markup).toContain('<div><b>done</b><span title="2026-09-18 21:51">21:51</span></div>');
    expect(markup).not.toContain('<b>delivered</b>');
  });

  // A derivation may not invent a phase the row never reached: an in-progress row has not been reviewed, whatever its ticket carries.
  test('derives no phase past the one the row is in', () => {
    const markup = panelFor(exampleTask({ status: 'in-progress', ticket: '001' }), exampleTicket({ finished: FINISHED_AT, delivered: DELIVERED_AT }));

    expect(phaseLabelsIn(markup)).toEqual(['To do', 'In progress']);
  });

  /**
   * An abandoned row's `end` is the moment it was abandoned — `TaskTransitionUtil` stamps it there — so reading it as a
   * finish would claim a review that never happened, and at the very instant the row was called off.
   */
  test('reads an abandoned row’s end as the abandonment and not as a review it never had', () => {
    const withoutTicket = panelFor(exampleTask({ status: 'abandoned', end: FINISHED_AT }));
    const withTicket    = panelFor(
      exampleTask({ status: 'abandoned', end: FINISHED_AT, ticket: '001' }),
      exampleTicket({ status: 'abandoned', abandonedAt: DELIVERED_AT }),
    );

    expect(phaseLabelsIn(withoutTicket)).toEqual(['In progress', 'Abandoned']);
    expect(phaseLabelsIn(withTicket)).toEqual(['To do', 'In progress', 'Abandoned']);
  });

  // The ticket's own `finished` stamp is evidence the row really was in review before it was called off; the row's `end` is not.
  test('derives the review of a row abandoned out of review from the ticket’s finished stamp', () => {
    const markup = panelFor(
      exampleTask({ status: 'abandoned', end: DELIVERED_AT, ticket: '001' }),
      exampleTicket({ status: 'abandoned', finished: FINISHED_AT, abandonedAt: DELIVERED_AT }),
    );

    expect(phaseLabelsIn(markup)).toEqual(['To do', 'In progress', 'Awaiting review', 'Abandoned']);
  });

  // `TaskTransitionUtil` drops `reviewRound` when a row goes back to pending, so a panel counting every round in the list would outrun the pill.
  test('restarts the review rounds after the row was sent back to pending', () => {
    const markup = panelFor(exampleTask({
      status:  're-review',
      history: [
        { status: 'in-review', at: FILED_AT },
        { status: 're-review', at: STARTED_AT },
        { status: 'pending', at: FINISHED_AT },
        { status: 'in-progress', at: REVIEWED_AT },
        { status: 'in-review', at: DELIVERED_AT },
        { status: 're-review', at: '2026-09-18T22:10:00+02:00' },
      ],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['Awaiting review', 'Reviewing (round 2)', 'To do', 'In progress', 'Awaiting review', 'Reviewing (round 2)']);
  });

  test('gives no gap to a phase stamped before the one it follows', () => {
    const markup = panelFor(exampleTask({
      status:  'in-review',
      history: [{ status: 'in-progress', at: FINISHED_AT }, { status: 'in-review', at: STARTED_AT }],
    }));

    expect(phaseLabelsIn(markup)).toEqual(['In progress', 'Awaiting review']);
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
        status:  'in-progress',
        ticket:  '001',
        start:   yesterday,
        history: [{ status: 'in-progress', at: yesterday }],
      }),
      exampleTicket({ filed: lastYear, started: yesterday }),
      [{ at: yesterday, text: 'Ticket #001 started' }],
    );

    expect(markup).toContain('<div><b>start</b><span title="2026-09-17 23:48">09-17 23:48</span></div>');
    expect(markup).toContain('<span class="ap-pill">In progress</span><time title="2026-09-17 23:48">09-17 23:48</time>');
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

    expect(markup).toContain('<span class="ap-badge in-progress">In progress</span>');
    expect(markup).toContain('<span class="ap-detail-type">change</span>');
    expect(markup).toContain('<div><b>integration</b><span class="ap-integration">lands together on <span class="ap-integration-branch">group-role-editor</span>, no release');
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
  const log: IdentifiedLogEntry[] = [
    {
      at:        FILED_AT,
      text:      'Ticket #001 filed: Double-click a role to edit it',
      taskIds:   [],
      ticketIds: ['001'],
    },
    {
      at:        STARTED_AT,
      text:      'Ticket #002 started',
      taskIds:   [],
      ticketIds: ['002'],
    },
    {
      at:        FINISHED_AT,
      text:      'Review row #1 started: Review 1 #001 — Double-click a role to edit it',
      taskIds:   [1],
      ticketIds: ['001'],
    },
    {
      at:        DELIVERED_AT,
      text:      'Ticket #001 delivered',
      taskIds:   [],
      ticketIds: ['001'],
    },
  ];

  function logLinesIn(markup: string): Array<string | undefined> {
    return [...markup.matchAll(/<span>([^<]*)<\/span><\/li>/g)].map((match) => match[1]);
  }

  test('keeps the lines whose ids hold this row or its ticket, newest first', () => {
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

  test('claims a line the tool wrote by its ticket id, not by the ticket numbers its sentence names', () => {
    const identifiedLog: IdentifiedLogEntry[] = [
      {
        at:        FILED_AT,
        text:      'Ticket #001 filed: Fix #002',
        taskIds:   [],
        ticketIds: ['001'],
      },
      {
        at:        STARTED_AT,
        text:      'Ticket #003 held: waits on #001',
        taskIds:   [],
        ticketIds: ['003'],
      },
    ];

    expect(logLinesIn(panelFor(null, exampleTicket({ id: '001' }), identifiedLog))).toEqual(['Ticket #001 filed: Fix #002']);
    expect(logLinesIn(panelFor(null, exampleTicket({ id: '002' }), identifiedLog))).toEqual([]);
  });

  test('claims a review bar’s lines for its row and its ticket by id, even when the bar’s name no longer names the ticket', () => {
    const identifiedLog: IdentifiedLogEntry[] = [
      {
        at:        FINISHED_AT,
        text:      'Review row #9 started: Renamed pass',
        taskIds:   [9],
        ticketIds: ['001'],
      },
    ];

    expect(logLinesIn(panelFor(exampleTask({ id: 9, name: 'Renamed pass' }), null, identifiedLog))).toEqual(['Review row #9 started: Renamed pass']);
    expect(logLinesIn(panelFor(null, exampleTicket({ id: '001' }), identifiedLog))).toEqual(['Review row #9 started: Renamed pass']);
  });

  test('shows a dependency line in the panel of the waiting ticket and of each ticket it waits on', () => {
    const identifiedLog: IdentifiedLogEntry[] = [
      {
        at:        FILED_AT,
        text:      'Ticket #003 waits on #001 and #002',
        taskIds:   [],
        ticketIds: ['003', '001', '002'],
      },
    ];

    for (const ticketId of ['003', '001', '002']) {
      expect(logLinesIn(panelFor(null, exampleTicket({ id: ticketId, task: null }), identifiedLog)), ticketId).toEqual(['Ticket #003 waits on #001 and #002']);
    }
    expect(logLinesIn(panelFor(null, exampleTicket({ id: '004', task: null }), identifiedLog))).toEqual([]);
  });

  test('does not show a line in the panel of a ticket or row that only its title, reason or bar name mentions', () => {
    const identifiedLog: IdentifiedLogEntry[] = [
      {
        at:        FILED_AT,
        text:      'Ticket #004 filed: Follow up on #001',
        taskIds:   [],
        ticketIds: ['004'],
      },
      {
        at:        STARTED_AT,
        text:      'Ticket #004 abandoned: duplicate of #001',
        taskIds:   [],
        ticketIds: ['004'],
      },
      {
        at:        FINISHED_AT,
        text:      'Review row #9 started: Review 1 #004 — compare with task #1 and #001',
        taskIds:   [9],
        ticketIds: ['004'],
      },
    ];

    expect(logLinesIn(panelFor(exampleTask({ id: 1, ticket: '001' }), exampleTicket({ id: '001' }), identifiedLog))).toEqual([]);
  });

  test('shows a line that concerns no row and no ticket in no panel', () => {
    const identifiedLog: IdentifiedLogEntry[] = [
      {
        at:        FILED_AT,
        text:      'Dispatcher set to running (run task #1 for #001)',
        taskIds:   [],
        ticketIds: [],
      },
    ];

    expect(logLinesIn(panelFor(exampleTask({ id: 1, ticket: '001' }), exampleTicket({ id: '001' }), identifiedLog))).toEqual([]);
  });

  test('shows each ticket of a two-ticket claim its own started line and not the other’s', () => {
    const identifiedLog: IdentifiedLogEntry[] = [
      {
        at:        STARTED_AT,
        text:      'Ticket #001 started',
        taskIds:   [],
        ticketIds: ['001'],
      },
      {
        at:        STARTED_AT,
        text:      'Ticket #002 started',
        taskIds:   [],
        ticketIds: ['002'],
      },
    ];

    expect(logLinesIn(panelFor(null, exampleTicket({ id: '001', task: null }), identifiedLog))).toEqual(['Ticket #001 started']);
    expect(logLinesIn(panelFor(null, exampleTicket({ id: '002', task: null }), identifiedLog))).toEqual(['Ticket #002 started']);
  });

  // Phases says so in words when it has nothing; a labelled empty box beside it would read as a section that failed to load.
  test('says no line names this row rather than showing an empty box', () => {
    const markup = panelFor(exampleTask({ id: 1 }), null, [{ at: FINISHED_AT, text: '#13 finished' }]);

    expect(markup).not.toContain('<ul class="ap-detail-log"></ul>');
    expect(markup).toContain('No log line names this row');
  });
});
