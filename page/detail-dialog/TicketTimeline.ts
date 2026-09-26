/**
 * The data of a ticket's detail-panel Timeline: the Progress chart's grid at a smaller scale, laid over one ticket's stamps, its own
 * row's phases and its review rows. DOM-free, and reads no clock: the page's now is handed in.
 * `page/detail-dialog/TicketTimelineMarkup.ts` draws it.
 */

import type { DisplayState, Task, TaskPhase }          from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                   from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { TicketDefaultsUtil }                          from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { PageTicket }                             from '../../src/shared/@types/PagePayload.ts';
import { MILLISECONDS_PER_MINUTE, PERCENT_OF_A_WHOLE } from '../constants/Units.ts';
import { BoardRulesUtil }                              from '../utils/BoardRulesUtil.ts';
import type { TimelineLimits, TimelineTick }           from '../utils/GeometryUtil.ts';
import { GeometryUtil }                                from '../utils/GeometryUtil.ts';
import { TimeUtil }                                    from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }                          from '../utils/WorkItemMarkupUtil.ts';
import type {
  ClosedTicketState,
  LegendEntry,
  ReviewSpan,
  TicketTimeline,
  TicketTimelineAxis,
  TicketTimelineInput,
  TimelineEnd,
  TimelineSpan,
} from './@types/TicketTimeline.ts';

const AXIS_PADDING_FRACTION_PER_SIDE = 0.025;

export const TICKET_TIMELINE_MAXIMUM_TICKS = 9;

const LOW_PRIORITY_WITHOUT_ROW_NOTE = 'Not started. Low priority: it gets a build row once it is started, after every normal and high ticket is delivered.';
const ABANDONED_WITHOUT_ROW_NOTE    = 'Abandoned before it was started; it never had a build row.';
const ABANDONED_BEFORE_START_NOTE   = 'Abandoned before it was started.';

/** The row statuses a build has ended by, so a row's `end` stands in for the finish only on one of them, never on an abandoned row. */
const ROW_STATUSES_PAST_THE_BUILD: readonly Task['status'][] = ['in-review', 're-review', 'reviewed', 'delivered'];

export function clockLabelFor(epochMilliseconds: number): string {
  return TimeUtil.shortInstantText(epochMilliseconds, TimeUtil.calendarDateOf(epochMilliseconds));
}

function closedStateOf(ticket: PageTicket): ClosedTicketState | null {
  if (ticket.status === 'delivered' || ticket.status === 'abandoned') {
    return ticket.status;
  }
  return null;
}

/** A closed ticket missing its closing stamp ends at `updated`, never at now: it is closed, and a now marker would say otherwise. */
function closingStampOf(ticket: PageTicket, closedState: ClosedTicketState | null): string | null {
  if (closedState === 'delivered') {
    return ticket.delivered ?? ticket.updated;
  }
  if (closedState === 'abandoned') {
    return ticket.abandonedAt ?? ticket.updated;
  }
  return null;
}

function smallestLadderStepMilliseconds(limits: TimelineLimits): number {
  const positiveSteps = limits.tickStepLadderMinutes.filter((minutes) => minutes > 0);
  return (positiveSteps.length === 0 ? 1 : Math.min(...positiveSteps)) * MILLISECONDS_PER_MINUTE;
}

function axisFor(filedEpochMilliseconds: number, lastMomentEpochMilliseconds: number, limits: TimelineLimits): TicketTimelineAxis {
  const spanMilliseconds    = lastMomentEpochMilliseconds - filedEpochMilliseconds;
  const paddingMilliseconds = spanMilliseconds * AXIS_PADDING_FRACTION_PER_SIDE;
  const paddedMilliseconds  = spanMilliseconds + 2 * paddingMilliseconds;
  const widening            = Math.max(0, smallestLadderStepMilliseconds(limits) - paddedMilliseconds) / 2;
  return {
    fromEpochMilliseconds: filedEpochMilliseconds - paddingMilliseconds - widening,
    toEpochMilliseconds:   lastMomentEpochMilliseconds + paddingMilliseconds + widening,
    filedEpochMilliseconds,
    lastMomentEpochMilliseconds,
  };
}

function ticksFor(axis: TicketTimelineAxis, limits: TimelineLimits): TimelineTick[] {
  const spanMinutes = (axis.toEpochMilliseconds - axis.fromEpochMilliseconds) / MILLISECONDS_PER_MINUTE;
  const stepMinutes = GeometryUtil.chooseStepMinutes(spanMinutes, null, { ...limits, maximumTicksPerAxis: TICKET_TIMELINE_MAXIMUM_TICKS });
  return GeometryUtil.buildTicks(axis, stepMinutes, spanMinutes, limits);
}

export function percentAlong(axis: TicketTimelineAxis, epochMilliseconds: number): number {
  return (epochMilliseconds - axis.fromEpochMilliseconds) / (axis.toEpochMilliseconds - axis.fromEpochMilliseconds) * PERCENT_OF_A_WHOLE;
}

function timelineSpan(state: DisplayState, label: string, startEpochMilliseconds: number, endEpochMilliseconds: number, isLive: boolean): TimelineSpan {
  return {
    state,
    label,
    startEpochMilliseconds,
    endEpochMilliseconds,
    isLive,
  };
}

/** A state's pill label; only `re-review` carries a round, and every caller of this passes another state. */
function stateLabelOf(state: DisplayState): string {
  return WorkItemMarkupUtil.pillLabelForDisplayState(state, FIRST_REPEAT_REVIEW_ROUND);
}

function buildSpan(state: 'in-progress' | 'paused', startEpochMilliseconds: number, endEpochMilliseconds: number, isLive: boolean): TimelineSpan {
  return timelineSpan(state, stateLabelOf(state), startEpochMilliseconds, endEpochMilliseconds, isLive);
}

/** One segment per recorded `in-progress` or `paused` phase, each to the next phase; a row without such a phase gets one from its `start`. */
function buildSegmentsOf(ownRow: Task | null, lastMomentEpochMilliseconds: number, ticketIsClosed: boolean): TimelineSpan[] {
  if (ownRow === null) {
    return [];
  }
  const history           = ownRow.history ?? [];
  const rowEndMilliseconds = TimeUtil.epochMillisecondsOf(ownRow.end);
  const recorded = history.flatMap((phase, index) => {
    const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(phase.at);
    if ((phase.status !== 'in-progress' && phase.status !== 'paused') || startEpochMilliseconds === null) {
      return [];
    }
    const nextPhase = history[index + 1];
    const isLast    = nextPhase === undefined;
    const end       = TimeUtil.epochMillisecondsOf(nextPhase?.at) ?? rowEndMilliseconds ?? lastMomentEpochMilliseconds;
    return [buildSpan(phase.status, startEpochMilliseconds, end, isLast && rowEndMilliseconds === null && !ticketIsClosed)];
  });
  if (recorded.length > 0) {
    return recorded;
  }
  const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(ownRow.start);
  if (startEpochMilliseconds === null) {
    return [];
  }
  const state = ownRow.status === 'paused' ? 'paused' : 'in-progress';
  return [buildSpan(state, startEpochMilliseconds, rowEndMilliseconds ?? lastMomentEpochMilliseconds, rowEndMilliseconds === null && !ticketIsClosed)];
}

/** The latest build's `in-review` phase; a reopened ticket building again has none, as its history's `in-progress` came after it. */
function latestBuildFinishedPhaseOf(ownRow: Task | null): TaskPhase | undefined {
  const history         = ownRow?.history ?? [];
  const latestBuildMove = history.findLast((phase) => phase.status === 'in-progress' || phase.status === 'paused' || phase.status === 'in-review');
  return latestBuildMove?.status === 'in-review' ? latestBuildMove : undefined;
}

function buildEndOf(ticket: PageTicket, ownRow: Task | null): number | null {
  const finishedPhase = latestBuildFinishedPhaseOf(ownRow);
  const rowEnd        = ownRow !== null && ROW_STATUSES_PAST_THE_BUILD.includes(ownRow.status) ? TimeUtil.epochMillisecondsOf(ownRow.end) : null;
  return TimeUtil.epochMillisecondsOf(ticket.finished) ?? TimeUtil.epochMillisecondsOf(finishedPhase?.at) ?? rowEnd;
}

function reviewSpansOf(reviewRows: readonly Task[], lastMomentEpochMilliseconds: number, ticketIsClosed: boolean): ReviewSpan[] {
  const started = reviewRows.flatMap((row) => {
    const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(row.start);
    return startEpochMilliseconds === null ? [] : [{ row, startEpochMilliseconds }];
  });
  return started.map(({ row, startEpochMilliseconds }, index) => {
    const round = index + 1;
    const end   = TimeUtil.epochMillisecondsOf(row.end);
    return {
      ...timelineSpan(round === 1 ? 'reviewing' : 're-review', `Review ${round}`, startEpochMilliseconds, end ?? lastMomentEpochMilliseconds, end === null && !ticketIsClosed),
      round,
      tokens: row.tokens,
    };
  });
}

interface AfterBuildInput {
  buildEndEpochMilliseconds:   number | null;
  reviews:                     readonly ReviewSpan[];
  reviewedEpochMilliseconds:   number | null;
  closedState:                 ClosedTicketState | null;
  lastMomentEpochMilliseconds: number;
}

/** The waits after the build, whose reviewing spans run from one review row's start to the next's, or to the `reviewed` stamp. */
function afterBuildSpansOf(input: AfterBuildInput): TimelineSpan[] {
  const {
    buildEndEpochMilliseconds,
    reviews,
    reviewedEpochMilliseconds,
    lastMomentEpochMilliseconds,
  } = input;
  if (buildEndEpochMilliseconds === null) {
    return [];
  }
  const ticketIsClosed = input.closedState !== null;
  const span = (state: DisplayState, label: string, start: number, end: number): TimelineSpan => timelineSpan(
    state,
    label,
    start,
    end,
    end === lastMomentEpochMilliseconds && !ticketIsClosed,
  );
  const awaitingReview = (end: number): TimelineSpan => span('in-review', stateLabelOf('in-review'), buildEndEpochMilliseconds, end);
  const awaitingMerge  = (start: number): TimelineSpan => span('reviewed', stateLabelOf('reviewed'), start, lastMomentEpochMilliseconds);
  const spans: TimelineSpan[] = [];
  const firstReview = reviews[0];
  if (firstReview !== undefined) {
    spans.push(awaitingReview(firstReview.startEpochMilliseconds));
    reviews.forEach((review, index) => {
      const following = reviews[index + 1];
      const end       = following?.startEpochMilliseconds ?? reviewedEpochMilliseconds ?? lastMomentEpochMilliseconds;
      spans.push(span(review.state, WorkItemMarkupUtil.pillLabelForDisplayState(review.state, review.round), review.startEpochMilliseconds, end));
    });
    if (reviewedEpochMilliseconds !== null) spans.push(awaitingMerge(reviewedEpochMilliseconds));
  } else if (reviewedEpochMilliseconds !== null) {
    spans.push(awaitingReview(reviewedEpochMilliseconds), awaitingMerge(reviewedEpochMilliseconds));
  } else if (input.closedState === 'delivered') {
    spans.push(awaitingMerge(buildEndEpochMilliseconds));
  } else {
    spans.push(awaitingReview(lastMomentEpochMilliseconds));
  }
  return spans.filter((candidate) => candidate.endEpochMilliseconds > candidate.startEpochMilliseconds);
}

function legendOf(spans: readonly TimelineSpan[]): LegendEntry[] {
  const totals: Array<{ state: DisplayState; label: string; milliseconds: number }> = [];
  for (const span of spans) {
    const milliseconds = span.endEpochMilliseconds - span.startEpochMilliseconds;
    const existing     = totals.find((total) => total.label === span.label);
    if (existing === undefined) {
      totals.push({ state: span.state, label: span.label, milliseconds });
    } else {
      existing.milliseconds += milliseconds;
    }
  }
  return totals.flatMap((total) => {
    const durationText = total.milliseconds > 0 ? TimeUtil.formatDuration(total.milliseconds) : null;
    return durationText === null ? [] : [{ state: total.state, label: total.label, durationText }];
  });
}

function waitReasonOf(ticket: PageTicket, waitingOn: readonly string[]): string {
  if (ticket.hold !== undefined) {
    return ticket.hold === '' ? ' Held.' : ` Held: ${ticket.hold}.`;
  }
  return waitingOn.length === 0 ? '' : ` Waiting on #${waitingOn.join(', #')}.`;
}

interface NoteInput {
  ticket:             PageTicket;
  ownRow:             Task | null;
  hasStarted:         boolean;
  closedState:        ClosedTicketState | null;
  queuedMilliseconds: number;
  waitingOn:          readonly string[];
}

function noteOf(input: NoteInput): string | null {
  const { ticket, ownRow, closedState } = input;
  if (input.hasStarted) {
    return null;
  }
  if (closedState === 'abandoned') {
    return ownRow === null ? ABANDONED_WITHOUT_ROW_NOTE : ABANDONED_BEFORE_START_NOTE;
  }
  if (closedState !== null) {
    return null;
  }
  if (ownRow === null && TicketDefaultsUtil.ticketPriorityOf(ticket) === 'low') {
    return LOW_PRIORITY_WITHOUT_ROW_NOTE;
  }
  const queued = TimeUtil.formatDuration(input.queuedMilliseconds);
  return queued === null ? null : `Not started: in the queue for ${queued}.${waitReasonOf(ticket, input.waitingOn)}`;
}

function endOf(axis: TicketTimelineAxis, closedState: ClosedTicketState | null, closingStamp: string | null, input: TicketTimelineInput): TimelineEnd {
  const label = closedState === null || closingStamp === null
    ? `now ${clockLabelFor(input.nowEpochMilliseconds)}`
    : `${closedState} ${TimeUtil.shortStampText(closingStamp, input.todayCalendarDate, input.limits)}`;
  return { closedState, label, leftPercent: percentAlong(axis, axis.lastMomentEpochMilliseconds) };
}

export function durationTextOf(milliseconds: number): string {
  return TimeUtil.formatDuration(milliseconds) ?? '';
}

export function ticketTimelineOf(input: TicketTimelineInput): TicketTimeline {
  const { ticket, tasks, limits } = input;
  const closedState               = closedStateOf(ticket);
  const closingStamp              = closingStampOf(ticket, closedState);
  const filedEpochMilliseconds    = TimeUtil.epochMillisecondsOf(ticket.filed) ?? input.nowEpochMilliseconds;
  const lastMoment                = Math.max(filedEpochMilliseconds, TimeUtil.epochMillisecondsOf(closingStamp) ?? input.nowEpochMilliseconds);
  const axis                      = axisFor(filedEpochMilliseconds, lastMoment, limits);
  const ownRow                    = BoardRulesUtil.ownRowOf(ticket.id, tasks);
  const buildSegments             = buildSegmentsOf(ownRow, lastMoment, closedState !== null);
  const firstSegment              = buildSegments[0];
  const lastSegment               = buildSegments.at(-1);
  const queueIsOpen               = firstSegment === undefined && closedState === null;
  const queue                     = timelineSpan('pending', stateLabelOf('pending'), filedEpochMilliseconds, firstSegment?.startEpochMilliseconds ?? lastMoment, queueIsOpen);
  const queuedMilliseconds        = queue.endEpochMilliseconds - queue.startEpochMilliseconds;
  const reviews                   = reviewSpansOf(BoardRulesUtil.reviewRowsOf(ticket.id, tasks), lastMoment, closedState !== null);
  const afterBuild                = afterBuildSpansOf({
    buildEndEpochMilliseconds:   buildEndOf(ticket, ownRow),
    reviews,
    reviewedEpochMilliseconds:   TimeUtil.epochMillisecondsOf(ownRow?.reviewed),
    closedState,
    lastMomentEpochMilliseconds: lastMoment,
  });
  const noBuildText = ownRow === null ? 'no row' : 'not started';
  return {
    axis,
    ticks:         ticksFor(axis, limits),
    queue,
    queueTimeText: `${queueIsOpen ? 'waiting' : 'queued'} ${durationTextOf(queuedMilliseconds)}`,
    ownRowId:      ownRow?.id ?? null,
    buildSegments,
    buildTimeText: firstSegment === undefined || lastSegment === undefined
      ? noBuildText
      : durationTextOf(lastSegment.endEpochMilliseconds - firstSegment.startEpochMilliseconds),
    reviews,
    afterBuild,
    legend: legendOf([queue, ...buildSegments, ...afterBuild]),
    end:    endOf(axis, closedState, closingStamp, input),
    note:   noteOf({
      ticket,
      ownRow,
      hasStarted: firstSegment !== undefined,
      closedState,
      queuedMilliseconds,
      waitingOn:  input.waitingOn,
    }),
  };
}
