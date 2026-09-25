/**
 * The Timeline a Kanban card's dialog draws, pinned on the approved design's three examples — #059 in its second review, #055 delivered,
 * #067 never started — at the design's now. Beside them the two shapes the design did not show: a row re-seeded without a history, which
 * still gets one build segment, and a delivered ticket missing its `delivered` stamp, whose axis ends at `updated` and never at now.
 * Instants are formatted in local time, so a clock the page computed is asserted through the same formatter, never as a literal.
 */

import { describe, expect, test }  from 'bun:test';
import {
  AXIS_MINIMUM_SPAN_MINUTES,
  AXIS_PADDING_MINUTES,
  CALENDAR_DATE_LENGTH,
  CLOCK_SLICE_END,
  CLOCK_SLICE_START,
  DATE_AND_CLOCK_LENGTH,
  DAY_MINUTES,
  HOUR_MINUTES,
  HOURS_AXIS_LABEL_LIMIT_MINUTES,
  MAXIMUM_TICKS_PER_AXIS,
  MINIMUM_BAR_WIDTH_PERCENT,
  MONTH_AND_DAY_SLICE_START,
  TICK_COUNT_SAFETY_BOUND,
  TICK_STEP_LADDER_MINUTES,
  WEEK_AXIS_LABEL_LIMIT_MINUTES,
} from '../constants/Limits.ts';
import type { Task, TaskPhase } from '../constants/Types.ts';
import type { PageTicket }      from './page/PageData.ts';
import type {
  TicketTimeline,
  TicketTimelineInput,
  TicketTimelineLimits,
  TimelineSpan,
} from './page/TicketTimeline.ts';
import {
  clockLabelFor,
  TICKET_TIMELINE_MAXIMUM_TICKS,
  tickLabelIsCovered,
  ticketTimelineMarkup,
  ticketTimelineOf,
} from './page/TicketTimeline.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_LIMITS: TicketTimelineLimits = {
  tickStepLadderMinutes:      TICK_STEP_LADDER_MINUTES,
  maximumTicksPerAxis:        MAXIMUM_TICKS_PER_AXIS,
  axisMinimumSpanMinutes:     AXIS_MINIMUM_SPAN_MINUTES,
  axisPaddingMinutes:         AXIS_PADDING_MINUTES,
  minimumBarWidthPercent:     MINIMUM_BAR_WIDTH_PERCENT,
  hoursAxisLabelLimitMinutes: HOURS_AXIS_LABEL_LIMIT_MINUTES,
  weekAxisLabelLimitMinutes:  WEEK_AXIS_LABEL_LIMIT_MINUTES,
  hourMinutes:                HOUR_MINUTES,
  dayMinutes:                 DAY_MINUTES,
  tickCountSafetyBound:       TICK_COUNT_SAFETY_BOUND,
  dateAndClockLength:         DATE_AND_CLOCK_LENGTH,
  calendarDateLength:         CALENDAR_DATE_LENGTH,
  monthAndDaySliceStart:      MONTH_AND_DAY_SLICE_START,
  clockSliceStart:            CLOCK_SLICE_START,
  clockSliceEnd:              CLOCK_SLICE_END,
};

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function phases(...entries: Array<[status: TaskPhase['status'], clock: string]>): TaskPhase[] {
  return entries.map(([status, clock]) => ({ status, at: at(clock) }));
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'bug',
    status:      'open',
    filed:       at('08:00'),
    updated:     at('08:00'),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '<p>Example description.</p>',
    ...changes,
  };
}

function exampleRow(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example row ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function reviewRow(id: number, ticketId: string, round: number, start: string, end: string | null, tokens: number): Task {
  return exampleRow(id, {
    name:     `Review ${round} #${ticketId} — Example ticket ${ticketId}`,
    status:   end === null ? 'running' : 'delivered',
    start:    at(start),
    end:      end === null ? null : at(end),
    tokens,
    reviewOf: ticketId,
  });
}

function inputFor(ticket: PageTicket, tasks: Task[], waitingOn: string[] = []): TicketTimelineInput {
  return {
    ticket,
    tasks,
    waitingOn,
    nowEpochMilliseconds: EXAMPLE_NOW,
    todayCalendarDate:    EXAMPLE_TODAY,
    limits:               EXAMPLE_LIMITS,
  };
}

const TICKET_059 = exampleTicket('059', {
  status:   'in-review',
  filed:    at('08:40'),
  started:  at('09:15'),
  finished: at('10:48'),
  task:     9,
});

const ROWS_059 = [
  exampleRow(9, {
    ticket:      '059',
    status:      're-review',
    reviewRound: 2,
    start:       at('09:15'),
    end:         at('10:48'),
    history:     phases(['pending', '08:40'], ['running', '09:15'], ['paused', '09:52'], ['running', '10:06'], ['finished', '10:48'], ['re-review', '11:34']),
  }),
  reviewRow(30, '059', 1, '10:50', '11:30', 1_200_000),
  reviewRow(31, '059', 2, '11:34', null, 780_000),
];

const TICKET_055 = exampleTicket('055', {
  status:    'delivered',
  priority:  'high',
  filed:     at('09:04'),
  started:   at('09:15'),
  finished:  at('10:48'),
  delivered: at('13:28'),
  updated:   at('13:28'),
  task:      7,
});

const ROWS_055 = [
  exampleRow(7, {
    ticket:   '055',
    status:   'delivered',
    start:    at('09:15'),
    end:      at('10:48'),
    reviewed: at('12:10'),
    history:  phases(['pending', '09:04'], ['running', '09:15'], ['finished', '10:48'], ['reviewed', '12:10'], ['delivered', '13:28']),
  }),
  reviewRow(26, '055', 1, '10:52', '11:30', 1_100_000),
];

const TICKET_067 = exampleTicket('067', { filed: at('10:12'), task: 17 });

const ROWS_067 = [exampleRow(17, { ticket: '067', history: phases(['pending', '10:12']) })];

function spansText(spans: readonly TimelineSpan[]): string {
  return spans.map((span) => `${span.label} ${span.endEpochMilliseconds - span.startEpochMilliseconds}`).join(' · ');
}

function legendText(timeline: TicketTimeline): string {
  return timeline.legend.map((entry) => `${entry.label} ${entry.durationText}`).join(' · ');
}

function minutes(count: number): number {
  return count * 60_000;
}

describe('the design’s #059, in its second review at the design’s now', () => {
  const timeline = ticketTimelineOf(inputFor(TICKET_059, ROWS_059));

  // The figure a reviewer re-derives by hand from the stamps: 08:40→09:15, 09:15→09:52 + 10:06→10:48, 09:52→10:06, 10:48→10:50,
  // 10:50→11:34 and 11:34→13:36.
  test('its legend sums the time in each state, in first-seen order', () => {
    expect(legendText(timeline)).toBe('unstarted 35m · wip 1h 19m · paused 14m · awaiting review 2m · reviewing 44m · reviewing 2 2h 2m');
  });

  test('its Build row splits into wip, paused and wip, each to the next recorded phase', () => {
    expect(timeline.buildSegments.map((segment) => segment.state)).toEqual(['running', 'paused', 'running']);
    expect(spansText(timeline.buildSegments)).toBe(`wip ${minutes(37)} · paused ${minutes(14)} · wip ${minutes(42)}`);
    expect(timeline.buildSegments.some((segment) => segment.isLive)).toBe(false);
    expect(timeline.buildTimeText).toBe('1h 33m');
  });

  test('it has two Review rows, oldest first, and only the second is live', () => {
    expect(timeline.reviews.map((review) => [review.label, review.state, review.isLive])).toEqual([
      ['Review 1', 'reviewing', false],
      ['Review 2', 're-review', true],
    ]);
    expect(timeline.reviews[1]?.endEpochMilliseconds).toBe(EXAMPLE_NOW);
  });

  test('its end marker is now, labelled with the now clock and no closed state', () => {
    expect(timeline.end.label).toBe(`now ${clockLabelFor(EXAMPLE_NOW)}`);
    expect(timeline.end.closedState).toBeNull();
    expect(timeline.note).toBeNull();
  });

  test('its axis runs from filed to now widened by 2.5% on each side, with at most nine clock ticks', () => {
    const span = EXAMPLE_NOW - Date.parse(at('08:40'));
    expect(timeline.axis.fromEpochMilliseconds).toBe(Date.parse(at('08:40')) - span * 0.025);
    expect(timeline.axis.toEpochMilliseconds).toBe(EXAMPLE_NOW + span * 0.025);
    expect(timeline.ticks.length).toBeGreaterThan(0);
    expect(timeline.ticks.length).toBeLessThanOrEqual(TICKET_TIMELINE_MAXIMUM_TICKS);
    expect(timeline.ticks.every((tick) => /^\d\d:\d\d$/.test(tick.label))).toBe(true);
  });

  test('the Filed row is named with its clock, reads queued, and its quiet bar is drawn in the markup', () => {
    const markup = ticketTimelineMarkup(inputFor(TICKET_059, ROWS_059));
    expect(timeline.queueTimeText).toBe('queued 35m');
    expect(markup).toContain('<span class="ap-name">Filed <span class="mono">08:40</span></span>');
    expect(markup).toContain('title="filed 2026-09-25 08:40 · in the queue 35m"');
    expect(markup).toContain('<span class="ap-name">Build <span class="mono">#9</span></span>');
    expect(markup.match(/class="ap-bar ap-bar-segment"/g)?.length).toBe(3);
    expect(markup).toContain(' · 780k tokens"');
  });
});

describe('the design’s #055, delivered', () => {
  const timeline = ticketTimelineOf(inputFor(TICKET_055, ROWS_055));

  test('it was queued 11 minutes and built in 1h 33m', () => {
    expect(timeline.queueTimeText).toBe('queued 11m');
    expect(timeline.buildTimeText).toBe('1h 33m');
  });

  test('after the build it waited for review, was reviewed until the reviewed stamp, then awaited its merge until delivery', () => {
    expect(timeline.afterBuild.map((span) => span.label)).toEqual(['awaiting review', 'reviewing', 'awaiting merge']);
    expect(spansText(timeline.afterBuild)).toBe(`awaiting review ${minutes(4)} · reviewing ${minutes(78)} · awaiting merge ${minutes(78)}`);
    expect(legendText(timeline)).toBe('unstarted 11m · wip 1h 33m · awaiting review 4m · reviewing 1h 18m · awaiting merge 1h 18m');
    expect(timeline.afterBuild.some((span) => span.isLive)).toBe(false);
  });

  test('its end marker is the delivered stamp in the delivered state, and nothing says now', () => {
    expect(timeline.end).toMatchObject({ closedState: 'delivered', label: 'delivered 13:28' });
    expect(ticketTimelineMarkup(inputFor(TICKET_055, ROWS_055))).not.toContain('now ');
  });

  test('a lifecycle segment 9% of the axis or wider carries its label, a narrower one none', () => {
    const markup = ticketTimelineMarkup(inputFor(TICKET_055, ROWS_055));
    expect(markup).toMatch(/data-state="reviewed"[^>]*>awaiting merge<\/div>/);
    expect(markup).toMatch(/data-state="finished"[^>]*><\/div>/);
  });
});

describe('the design’s #067, filed and never started', () => {
  const timeline = ticketTimelineOf(inputFor(TICKET_067, ROWS_067));

  test('it has been waiting since it was filed, its Build row is not started and the note says how long it has queued', () => {
    expect(timeline.queueTimeText).toBe('waiting 3h 24m');
    expect(timeline.queue.isLive).toBe(true);
    expect(timeline.buildTimeText).toBe('not started');
    expect(timeline.buildSegments).toEqual([]);
    expect(timeline.afterBuild).toEqual([]);
    expect(timeline.note).toBe('Not started: in the queue for 3h 24m.');
    expect(legendText(timeline)).toBe('unstarted 3h 24m');
  });

  test('the Filed bar’s title says so far while it waits', () => {
    expect(ticketTimelineMarkup(inputFor(TICKET_067, ROWS_067))).toContain('in the queue 3h 24m so far');
  });

  test('a held ticket’s note gives the reason, and a waiting one names what it waits on', () => {
    expect(ticketTimelineOf(inputFor({ ...TICKET_067, hold: 'Copy from Example Agency' }, ROWS_067)).note)
      .toBe('Not started: in the queue for 3h 24m. Held: Copy from Example Agency.');
    expect(ticketTimelineOf(inputFor(TICKET_067, ROWS_067, ['060'])).note).toBe('Not started: in the queue for 3h 24m. Waiting on #060.');
  });
});

describe('the shapes the design did not show', () => {
  // A row filed before `history` existed, or re-seeded, has only its stamps: it still gets a build segment rather than an empty track.
  test('a running row with no history gets one live running segment from its start, counted as wip', () => {
    const ticket   = exampleTicket('070', {
      status: 'in-progress', filed: at('09:00'), started: at('10:00'), task: 40 
    });
    const timeline = ticketTimelineOf(inputFor(ticket, [exampleRow(40, { ticket: '070', status: 'running', start: at('10:00') })]));
    expect(timeline.buildSegments.map((segment) => [segment.state, segment.isLive])).toEqual([['running', true]]);
    expect(legendText(timeline)).toBe('unstarted 1h · wip 3h 36m');
  });

  test('a paused row with no history gets one paused segment instead', () => {
    const ticket   = exampleTicket('071', {
      status: 'in-progress', filed: at('09:00'), started: at('10:00'), task: 41 
    });
    const timeline = ticketTimelineOf(inputFor(ticket, [exampleRow(41, { ticket: '071', status: 'paused', start: at('10:00') })]));
    expect(timeline.buildSegments.map((segment) => segment.state)).toEqual(['paused']);
    expect(legendText(timeline)).toBe('unstarted 1h · paused 3h 36m');
  });

  // Tickets delivered before the stamp was written exist; ending their axis at now would draw a closed ticket as still open.
  test('a delivered ticket without its delivered stamp ends its axis at updated, with the closed marker and no now', () => {
    const ticket   = exampleTicket('072', {
      status: 'delivered', filed: at('09:00'), finished: at('10:00'), updated: at('12:00'), task: 42 
    });
    const rows     = [exampleRow(42, {
      ticket: '072', status: 'delivered', start: at('09:30'), end: at('10:00') 
    })];
    const timeline = ticketTimelineOf(inputFor(ticket, rows));
    expect(timeline.axis.lastMomentEpochMilliseconds).toBe(Date.parse(at('12:00')));
    expect(timeline.end).toMatchObject({ closedState: 'delivered', label: 'delivered 12:00' });
    expect(timeline.afterBuild.map((span) => span.label)).toEqual(['awaiting merge']);
    expect(ticketTimelineMarkup(inputFor(ticket, rows))).not.toContain('now ');
  });

  // `reopen` clears the ticket's stamps but the row's history keeps the first build's `finished` phase.
  test('a reopened ticket building again has no wait after the build, whatever its first build finished at', () => {
    const ticket   = exampleTicket('078', {
      status: 'in-progress', filed: at('09:00'), started: at('11:00'), task: 44,
    });
    const rows     = [exampleRow(44, {
      ticket:  '078',
      status:  'running',
      start:   at('11:00'),
      history: phases(['pending', '09:00'], ['running', '09:15'], ['finished', '10:00'], ['pending', '10:30'], ['running', '11:00']),
    })];
    const timeline = ticketTimelineOf(inputFor(ticket, rows));
    expect(timeline.afterBuild).toEqual([]);
    expect(timeline.buildSegments.map((segment) => [segment.state, segment.isLive])).toEqual([['running', false], ['running', true]]);
  });

  test('a low ticket without a row has no build row and says why', () => {
    const timeline = ticketTimelineOf(inputFor(exampleTicket('073', { priority: 'low', filed: at('12:00') }), []));
    expect(timeline.buildTimeText).toBe('no row');
    expect(timeline.note).toBe('Not started. Low priority: it gets a build row once it is started, after every normal and high ticket is delivered.');
  });

  test('a ticket abandoned before it started ends at its abandonment and is not waiting', () => {
    const ticket   = exampleTicket('074', { status: 'abandoned', filed: at('09:00'), abandonedAt: at('09:40') });
    const timeline = ticketTimelineOf(inputFor(ticket, []));
    expect(timeline.queueTimeText).toBe('queued 40m');
    expect(timeline.end).toMatchObject({ closedState: 'abandoned', label: 'abandoned 09:40' });
    expect(timeline.note).toBe('Abandoned before it was started; it never had a build row.');
  });

  test('a ticket filed on another day names Filed alone, with the full stamp as its title', () => {
    const markup = ticketTimelineMarkup(inputFor(exampleTicket('075', { filed: at('17:40', '2026-09-24') }), []));
    expect(markup).toContain('<span class="ap-name" title="filed 2026-09-24 17:40">Filed</span>');
  });

  test('a ticket filed this very moment still gets an axis as wide as the smallest tick step', () => {
    const timeline = ticketTimelineOf(inputFor(exampleTicket('076', { filed: at('13:36') }), []));
    expect(timeline.axis.toEpochMilliseconds - timeline.axis.fromEpochMilliseconds).toBe(minutes(TICK_STEP_LADDER_MINUTES[0]));
  });

  test('every value from the ticket is escaped', () => {
    const markup = ticketTimelineMarkup(inputFor(exampleTicket('077', { hold: '<b>held</b>', filed: at('12:00') }), [exampleRow(43, { ticket: '077' })]));
    expect(markup).toContain('Held: &lt;b&gt;held&lt;/b&gt;.');
    expect(markup).not.toContain('<b>held</b>');
  });
});

describe('which tick labels the end label covers', () => {
  const endLabel = { left: 500, right: 560 };

  test('a label that overlaps the end label or comes within six pixels of it is covered', () => {
    expect(tickLabelIsCovered({ left: 470, right: 505 }, endLabel)).toBe(true);
    expect(tickLabelIsCovered({ left: 460, right: 495 }, endLabel)).toBe(true);
    expect(tickLabelIsCovered({ left: 565, right: 600 }, endLabel)).toBe(true);
  });

  test('a label six pixels clear or further is not', () => {
    expect(tickLabelIsCovered({ left: 450, right: 494 }, endLabel)).toBe(false);
    expect(tickLabelIsCovered({ left: 566, right: 600 }, endLabel)).toBe(false);
  });
});
