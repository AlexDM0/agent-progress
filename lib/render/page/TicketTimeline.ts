/**
 * The Timeline of a ticket's detail panel: the Progress chart's grid at a smaller scale, drawn over one ticket's stamps, its own row's
 * phases and its review rows. DOM-free, and reads no clock: the page's now is handed in.
 */

import { FIRST_REPEAT_REVIEW_ROUND }                               from '../../constants/Limits.ts';
import { ticketPriorityOf }                                        from '../../constants/Statuses.ts';
import type { Task, TaskPhase }                                    from '../../constants/Types.ts';
import { HtmlEscapeUtil }                                          from '../../utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }                                          from '../../utils/TokenCountUtil.ts';
import type { TimelineLimits, TimelineTick }                       from './GanttGeometry.ts';
import { buildTicks, chooseStepMinutes }                           from './GanttGeometry.ts';
import { ownRowOf }                                                from './KanbanBoard.ts';
import type { PageTicket }                                         from './PageData.ts';
import type { RowState, TimestampSlices }                          from './PageMarkup.ts';
import { attribute, pillLabelForRowState, reviewedTicketNumberOf } from './PageMarkup.ts';
import {
  calendarDateOf,
  fullStampText,
  shortInstantText,
  shortStampText,
} from './StampText.ts';
import { formatDuration } from './TaskDetail.ts';

const { escapeHtml }       = HtmlEscapeUtil;
const { formatTokenCount } = TokenCountUtil;

const MILLISECONDS_PER_MINUTE = 60_000;
const PERCENT_OF_A_WHOLE      = 100;
const PERCENT_DECIMAL_PLACES  = 2;

export const AXIS_PADDING_FRACTION_PER_SIDE = 0.025;
export const TICKET_TIMELINE_MAXIMUM_TICKS  = 9;
export const SEGMENT_LABEL_MINIMUM_PERCENT  = 9;
export const TICK_LABEL_CLEARANCE_PIXELS    = 6;

const LOW_PRIORITY_WITHOUT_ROW_NOTE = 'Not started. Low priority: it gets a build row once it is started, after every normal and high ticket is delivered.';
const ABANDONED_WITHOUT_ROW_NOTE    = 'Abandoned before it was started; it never had a build row.';
const ABANDONED_BEFORE_START_NOTE   = 'Abandoned before it was started.';

/** The row statuses a build has ended by, so a row's `end` stands in for the finish only on one of them, never on an abandoned row. */
const ROW_STATUSES_PAST_THE_BUILD: readonly Task['status'][] = ['finished', 're-review', 'reviewed', 'delivered'];

export type TicketTimelineLimits = TimelineLimits & TimestampSlices;

export interface TicketTimelineInput {
  ticket:               PageTicket;
  /** The whole progress file's rows, in which the ticket's own row and its review rows are looked up. */
  tasks:                readonly Task[];
  waitingOn:            readonly string[];
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  limits:               TicketTimelineLimits;
}

export interface TimelineSpan {
  state:                  RowState;
  label:                  string;
  startEpochMilliseconds: number;
  endEpochMilliseconds:   number;
  isLive:                 boolean;
}

export interface ReviewSpan extends TimelineSpan {
  round:  number;
  tokens: number | null;
}

export interface TicketTimelineAxis {
  fromEpochMilliseconds:       number;
  toEpochMilliseconds:         number;
  filedEpochMilliseconds:      number;
  lastMomentEpochMilliseconds: number;
}

export interface LegendEntry {
  state:        RowState;
  label:        string;
  durationText: string;
}

export type ClosedTicketState = 'delivered' | 'abandoned';

export interface TimelineEnd {
  closedState: ClosedTicketState | null;
  label:       string;
  leftPercent: number;
}

export interface TicketTimeline {
  axis:          TicketTimelineAxis;
  ticks:         TimelineTick[];
  queue:         TimelineSpan;
  queueTimeText: string;
  ownRowId:      number | null;
  buildSegments: TimelineSpan[];
  buildTimeText: string;
  reviews:       ReviewSpan[];
  afterBuild:    TimelineSpan[];
  legend:        LegendEntry[];
  end:           TimelineEnd;
  note:          string | null;
}

export interface HorizontalExtent {
  left:  number;
  right: number;
}

function epochOf(stamp: string | null | undefined): number | null {
  if (stamp === null || stamp === undefined || stamp === '') {
    return null;
  }
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? null : parsed;
}

export function clockLabelFor(epochMilliseconds: number): string {
  return shortInstantText(epochMilliseconds, calendarDateOf(epochMilliseconds));
}

/** A tick label within the clearance of the end label on either side is covered by it; the page hides those after measuring both. */
export function tickLabelIsCovered(tickLabel: HorizontalExtent, endLabel: HorizontalExtent): boolean {
  return tickLabel.right + TICK_LABEL_CLEARANCE_PIXELS > endLabel.left && tickLabel.left - TICK_LABEL_CLEARANCE_PIXELS < endLabel.right;
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
  const stepMinutes = chooseStepMinutes(spanMinutes, null, { ...limits, maximumTicksPerAxis: TICKET_TIMELINE_MAXIMUM_TICKS });
  return buildTicks(axis, stepMinutes, spanMinutes, limits);
}

function percentAlong(axis: TicketTimelineAxis, epochMilliseconds: number): number {
  return (epochMilliseconds - axis.fromEpochMilliseconds) / (axis.toEpochMilliseconds - axis.fromEpochMilliseconds) * PERCENT_OF_A_WHOLE;
}

function timelineSpan(state: RowState, label: string, startEpochMilliseconds: number, endEpochMilliseconds: number, isLive: boolean): TimelineSpan {
  return {
    state,
    label,
    startEpochMilliseconds,
    endEpochMilliseconds,
    isLive,
  };
}

/** A state's pill label; only `re-review` carries a round, and every caller of this passes another state. */
function stateLabelOf(state: RowState): string {
  return pillLabelForRowState(state, FIRST_REPEAT_REVIEW_ROUND);
}

function buildSpan(state: 'running' | 'paused', startEpochMilliseconds: number, endEpochMilliseconds: number, isLive: boolean): TimelineSpan {
  return timelineSpan(state, stateLabelOf(state), startEpochMilliseconds, endEpochMilliseconds, isLive);
}

/** One segment per recorded `running` or `paused` phase, each to the next phase; a row without such a phase gets one from its `start`. */
function buildSegmentsOf(ownRow: Task | null, lastMomentEpochMilliseconds: number, ticketIsClosed: boolean): TimelineSpan[] {
  if (ownRow === null) {
    return [];
  }
  const history           = ownRow.history ?? [];
  const rowEndMilliseconds = epochOf(ownRow.end);
  const recorded = history.flatMap((phase, index) => {
    const startEpochMilliseconds = epochOf(phase.at);
    if ((phase.status !== 'running' && phase.status !== 'paused') || startEpochMilliseconds === null) {
      return [];
    }
    const nextPhase = history[index + 1];
    const isLast    = nextPhase === undefined;
    const end       = epochOf(nextPhase?.at) ?? rowEndMilliseconds ?? lastMomentEpochMilliseconds;
    return [buildSpan(phase.status, startEpochMilliseconds, end, isLast && rowEndMilliseconds === null && !ticketIsClosed)];
  });
  if (recorded.length > 0) {
    return recorded;
  }
  const startEpochMilliseconds = epochOf(ownRow.start);
  if (startEpochMilliseconds === null) {
    return [];
  }
  const state = ownRow.status === 'paused' ? 'paused' : 'running';
  return [buildSpan(state, startEpochMilliseconds, rowEndMilliseconds ?? lastMomentEpochMilliseconds, rowEndMilliseconds === null && !ticketIsClosed)];
}

/** The latest build's `finished` phase; a reopened ticket building again has none, as its history's `running` came after it. */
function latestBuildFinishedPhaseOf(ownRow: Task | null): TaskPhase | undefined {
  const history         = ownRow?.history ?? [];
  const latestBuildMove = history.findLast((phase) => phase.status === 'running' || phase.status === 'paused' || phase.status === 'finished');
  return latestBuildMove?.status === 'finished' ? latestBuildMove : undefined;
}

function buildEndOf(ticket: PageTicket, ownRow: Task | null): number | null {
  const finishedPhase = latestBuildFinishedPhaseOf(ownRow);
  const rowEnd        = ownRow !== null && ROW_STATUSES_PAST_THE_BUILD.includes(ownRow.status) ? epochOf(ownRow.end) : null;
  return epochOf(ticket.finished) ?? epochOf(finishedPhase?.at) ?? rowEnd;
}

/** Oldest first by filing order, which is the row id: nothing here compares two clocks to decide an order. */
function reviewRowsOf(ticket: PageTicket, tasks: readonly Task[]): Task[] {
  const ticketNumber = Number(ticket.id);
  return tasks
    .filter((task) => task.ticket === null && reviewedTicketNumberOf(task) === ticketNumber)
    .toSorted((a, b) => a.id - b.id);
}

function reviewSpansOf(reviewRows: readonly Task[], lastMomentEpochMilliseconds: number, ticketIsClosed: boolean): ReviewSpan[] {
  const started = reviewRows.flatMap((row) => {
    const startEpochMilliseconds = epochOf(row.start);
    return startEpochMilliseconds === null ? [] : [{ row, startEpochMilliseconds }];
  });
  return started.map(({ row, startEpochMilliseconds }, index) => {
    const round = index + 1;
    const end   = epochOf(row.end);
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
  const span = (state: RowState, label: string, start: number, end: number): TimelineSpan => timelineSpan(
    state,
    label,
    start,
    end,
    end === lastMomentEpochMilliseconds && !ticketIsClosed,
  );
  const awaitingReview = (end: number): TimelineSpan => span('finished', stateLabelOf('finished'), buildEndEpochMilliseconds, end);
  const awaitingMerge  = (start: number): TimelineSpan => span('reviewed', stateLabelOf('reviewed'), start, lastMomentEpochMilliseconds);
  const spans: TimelineSpan[] = [];
  const firstReview = reviews[0];
  if (firstReview !== undefined) {
    spans.push(awaitingReview(firstReview.startEpochMilliseconds));
    reviews.forEach((review, index) => {
      const following = reviews[index + 1];
      const end       = following?.startEpochMilliseconds ?? reviewedEpochMilliseconds ?? lastMomentEpochMilliseconds;
      spans.push(span(review.state, pillLabelForRowState(review.state, review.round), review.startEpochMilliseconds, end));
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
  const totals: Array<{ state: RowState; label: string; milliseconds: number }> = [];
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
    const durationText = total.milliseconds > 0 ? formatDuration(total.milliseconds) : null;
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
  if (ownRow === null && ticketPriorityOf(ticket) === 'low') {
    return LOW_PRIORITY_WITHOUT_ROW_NOTE;
  }
  const queued = formatDuration(input.queuedMilliseconds);
  return queued === null ? null : `Not started: in the queue for ${queued}.${waitReasonOf(ticket, input.waitingOn)}`;
}

function endOf(axis: TicketTimelineAxis, closedState: ClosedTicketState | null, closingStamp: string | null, input: TicketTimelineInput): TimelineEnd {
  const label = closedState === null || closingStamp === null
    ? `now ${clockLabelFor(input.nowEpochMilliseconds)}`
    : `${closedState} ${shortStampText(closingStamp, input.todayCalendarDate, input.limits)}`;
  return { closedState, label, leftPercent: percentAlong(axis, axis.lastMomentEpochMilliseconds) };
}

function durationTextOf(milliseconds: number): string {
  return formatDuration(milliseconds) ?? '';
}

export function ticketTimelineOf(input: TicketTimelineInput): TicketTimeline {
  const { ticket, tasks, limits } = input;
  const closedState               = closedStateOf(ticket);
  const closingStamp              = closingStampOf(ticket, closedState);
  const filedEpochMilliseconds    = epochOf(ticket.filed) ?? input.nowEpochMilliseconds;
  const lastMoment                = Math.max(filedEpochMilliseconds, epochOf(closingStamp) ?? input.nowEpochMilliseconds);
  const axis                      = axisFor(filedEpochMilliseconds, lastMoment, limits);
  const ownRow                    = ownRowOf(ticket.id, tasks);
  const buildSegments             = buildSegmentsOf(ownRow, lastMoment, closedState !== null);
  const firstSegment              = buildSegments[0];
  const lastSegment               = buildSegments.at(-1);
  const queueIsOpen               = firstSegment === undefined && closedState === null;
  const queue                     = timelineSpan('pending', stateLabelOf('pending'), filedEpochMilliseconds, firstSegment?.startEpochMilliseconds ?? lastMoment, queueIsOpen);
  const queuedMilliseconds        = queue.endEpochMilliseconds - queue.startEpochMilliseconds;
  const reviews                   = reviewSpansOf(reviewRowsOf(ticket, tasks), lastMoment, closedState !== null);
  const afterBuild                = afterBuildSpansOf({
    buildEndEpochMilliseconds:   buildEndOf(ticket, ownRow),
    reviews,
    reviewedEpochMilliseconds:   epochOf(ownRow?.reviewed),
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

function percent(value: number): string {
  return `${value.toFixed(PERCENT_DECIMAL_PLACES)}%`;
}

function clampToAxis(value: number): number {
  return Math.min(PERCENT_OF_A_WHOLE, Math.max(0, value));
}

function barStyle(axis: TicketTimelineAxis, span: TimelineSpan, limits: TimelineLimits): string {
  const leftPercent  = clampToAxis(percentAlong(axis, span.startEpochMilliseconds));
  const rightPercent = clampToAxis(percentAlong(axis, span.endEpochMilliseconds));
  const widthPercent = Math.min(PERCENT_OF_A_WHOLE - leftPercent, Math.max(rightPercent - leftPercent, limits.minimumBarWidthPercent));
  return `left:${percent(leftPercent)};width:${percent(widthPercent)}`;
}

function spanTitle(span: TimelineSpan, label: string, todayCalendarDate: string): string {
  const startText = shortInstantText(span.startEpochMilliseconds, todayCalendarDate);
  const endText   = span.isLive ? ' → now' : `–${shortInstantText(span.endEpochMilliseconds, todayCalendarDate)}`;
  const duration  = formatDuration(span.endEpochMilliseconds - span.startEpochMilliseconds);
  return `${label} ${startText}${endText}${duration === null ? '' : ` · ${duration}`}`;
}

function liveAttribute(span: TimelineSpan): string {
  return span.isLive ? ' data-live' : '';
}

function ganttRowMarkup(nameMarkup: string, timeText: string, trackMarkup: string): string {
  return [
    `<div class="ap-grid-row ap-row"><div class="ap-cell-name">${nameMarkup}</div>`,
    `<div class="ap-cell-pill">${escapeHtml(timeText)}</div>`,
    `<div class="ap-cell-track">${trackMarkup}</div></div>`,
  ].join('');
}

function filedNameMarkup(ticket: PageTicket, input: TicketTimelineInput): string {
  const { limits, todayCalendarDate } = input;
  if (ticket.filed.slice(0, limits.calendarDateLength) === todayCalendarDate) {
    return `<span class="ap-name">Filed <span class="mono">${escapeHtml(shortStampText(ticket.filed, todayCalendarDate, limits))}</span></span>`;
  }
  return `<span class="ap-name" ${attribute('title', `filed ${fullStampText(ticket.filed, limits)}`)}>Filed</span>`;
}

function filedRowMarkup(timeline: TicketTimeline, input: TicketTimelineInput): string {
  const { queue, axis } = timeline;
  const queued          = durationTextOf(queue.endEpochMilliseconds - queue.startEpochMilliseconds);
  const title           = `filed ${fullStampText(input.ticket.filed, input.limits)} · in the queue ${queued}${queue.isLive ? ' so far' : ''}`;
  const bar             = `<div class="ap-bar ap-ticket-gantt-filed" style="${barStyle(axis, queue, input.limits)}" ${attribute('title', title)}></div>`;
  return ganttRowMarkup(filedNameMarkup(input.ticket, input), timeline.queueTimeText, bar);
}

function buildRowMarkup(timeline: TicketTimeline, input: TicketTimelineInput): string {
  const rowId    = timeline.ownRowId === null ? '' : ` <span class="mono">#${escapeHtml(String(timeline.ownRowId))}</span>`;
  const segments = timeline.buildSegments.map((segment) => [
    `<div class="ap-bar ap-bar-segment" ${attribute('data-state', segment.state)}${liveAttribute(segment)}`,
    ` style="${barStyle(timeline.axis, segment, input.limits)}" ${attribute('title', spanTitle(segment, segment.label, input.todayCalendarDate))}></div>`,
  ].join('')).join('');
  return ganttRowMarkup(`<span class="ap-name">Build${rowId}</span>`, timeline.buildTimeText, segments);
}

function reviewRowMarkup(review: ReviewSpan, timeline: TicketTimeline, input: TicketTimelineInput): string {
  const tokens = review.tokens === null ? '' : ` · ${formatTokenCount(review.tokens)} tokens`;
  const bar    = [
    `<div class="ap-bar" ${attribute('data-state', review.state)}${liveAttribute(review)} style="${barStyle(timeline.axis, review, input.limits)}"`,
    ` ${attribute('title', `${spanTitle(review, review.label, input.todayCalendarDate)}${tokens}`)}></div>`,
  ].join('');
  return ganttRowMarkup(`<span class="ap-name">${escapeHtml(review.label)}</span>`, durationTextOf(review.endEpochMilliseconds - review.startEpochMilliseconds), bar);
}

function afterBuildRowMarkup(timeline: TicketTimeline, input: TicketTimelineInput): string {
  const { afterBuild, axis } = timeline;
  const first                = afterBuild[0];
  const last                 = afterBuild.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }
  const segments = afterBuild.map((segment) => {
    const widthPercent = percentAlong(axis, segment.endEpochMilliseconds) - percentAlong(axis, segment.startEpochMilliseconds);
    const label        = widthPercent >= SEGMENT_LABEL_MINIMUM_PERCENT ? escapeHtml(segment.label) : '';
    return [
      `<div class="ap-bar ap-lifecycle-segment" ${attribute('data-state', segment.state)} style="${barStyle(axis, segment, input.limits)}"`,
      ` ${attribute('title', spanTitle(segment, segment.label, input.todayCalendarDate))}>${label}</div>`,
    ].join('');
  }).join('');
  return ganttRowMarkup('<span class="ap-name">After build</span>', durationTextOf(last.endEpochMilliseconds - first.startEpochMilliseconds), segments);
}

function legendMarkup(legend: readonly LegendEntry[]): string {
  const items = legend.map((entry) => [
    `<li><span class="ap-ticket-gantt-swatch" ${attribute('data-state', entry.state)}></span>`,
    `<b>${escapeHtml(entry.label)}</b><time>${escapeHtml(entry.durationText)}</time></li>`,
  ].join('')).join('');
  return `<ul class="ap-ticket-gantt-legend" aria-label="Time spent in each state">${items}</ul>`;
}

/** The chart, its legend and, for a ticket that never started, its note: the Timeline section's body. */
export function ticketTimelineMarkup(input: TicketTimelineInput): string {
  const timeline      = ticketTimelineOf(input);
  const { end }       = timeline;
  const endState      = end.closedState === null ? '' : ` ${attribute('data-state', end.closedState)}`;
  const endLeft       = `left:${percent(end.leftPercent)}`;
  const ticks         = timeline.ticks.map((tick) => `<div class="ap-tick" style="left:${percent(tick.leftPercent)}"><span>${escapeHtml(tick.label)}</span></div>`).join('');
  const gridLines     = timeline.ticks.map((tick) => `<div class="ap-grid-line" style="left:${percent(tick.leftPercent)}"></div>`).join('');
  const rows          = [
    filedRowMarkup(timeline, input),
    buildRowMarkup(timeline, input),
    ...timeline.reviews.map((review) => reviewRowMarkup(review, timeline, input)),
    afterBuildRowMarkup(timeline, input),
  ].join('');
  return [
    '<div class="ap-ticket-gantt"><div class="ap-grid-row ap-chart-head"><div class="ap-cell-name">Row</div><div class="ap-cell-pill">Time</div>',
    `<div class="ap-cell-track" style="height:100%"><div class="ap-ticket-gantt-ticks">${ticks}`,
    `<span class="ap-ticket-gantt-end-label"${endState} style="${endLeft}">${escapeHtml(end.label)}</span></div></div></div>`,
    `<div class="ap-body"><div class="ap-ticket-gantt-overlay">${gridLines}<div class="ap-ticket-gantt-end"${endState} style="${endLeft}"></div></div>`,
    `${rows}</div></div>`,
    legendMarkup(timeline.legend),
    timeline.note === null ? '' : `<p class="ap-ticket-gantt-note">${escapeHtml(timeline.note)}</p>`,
  ].join('');
}
