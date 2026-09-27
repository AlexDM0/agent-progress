/**
 * The markup of a ticket's detail-panel Timeline: the rows, bars, axis and legend drawn from `page/detail-dialog/TicketTimeline.ts`'s data.
 * Every value passes `escapeHtml` once here.
 */

import { HtmlEscapeUtil }      from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }      from '../../src/lib/token-count/TokenCountUtil.ts';
import type { PageTicket }     from '../../src/shared/@types/PagePayload.ts';
import type { TimelineLimits } from '../@types/Timeline.ts';
import { PERCENT_OF_A_WHOLE }  from '../constants/Units.ts';
import { MarkupUtil }          from '../utils/MarkupUtil.ts';
import { TimeUtil }            from '../utils/TimeUtil.ts';
import type {
  LegendEntry,
  ReviewSpan,
  TicketTimeline,
  TicketTimelineAxis,
  TicketTimelineInput,
  TimelineSpan,
} from './@types/TicketTimeline.ts';
import { ticketTimelineOf }   from './TicketTimeline.ts';
import { TicketTimelineUtil } from './utils/TicketTimelineUtil.ts';


const SEGMENT_LABEL_MINIMUM_PERCENT = 9;

function clampToAxis(value: number): number {
  return Math.min(PERCENT_OF_A_WHOLE, Math.max(0, value));
}

function barStyle(axis: TicketTimelineAxis, span: TimelineSpan, limits: TimelineLimits): string {
  const leftPercent  = clampToAxis(TicketTimelineUtil.percentAlong(axis, span.startEpochMilliseconds));
  const rightPercent = clampToAxis(TicketTimelineUtil.percentAlong(axis, span.endEpochMilliseconds));
  const widthPercent = Math.min(PERCENT_OF_A_WHOLE - leftPercent, Math.max(rightPercent - leftPercent, limits.minimumBarWidthPercent));
  return `left:${MarkupUtil.percentText(leftPercent)};width:${MarkupUtil.percentText(widthPercent)}`;
}

function spanTitle(span: TimelineSpan, label: string, input: TicketTimelineInput): string {
  const { todayCalendarDate, limits } = input;
  const startText = TimeUtil.shortInstantText(span.startEpochMilliseconds, todayCalendarDate);
  const endText   = span.isLive ? ' → now' : `–${TimeUtil.shortInstantText(span.endEpochMilliseconds, todayCalendarDate)}`;
  const duration  = TimeUtil.formatDuration(span.endEpochMilliseconds - span.startEpochMilliseconds, limits);
  return `${label} ${startText}${endText}${duration === null ? '' : ` · ${duration}`}`;
}

function liveAttribute(span: TimelineSpan): string {
  return span.isLive ? ' data-live' : '';
}

function ganttRowMarkup(nameMarkup: string, timeText: string, trackMarkup: string): string {
  return [
    `<div class="ap-grid-row ap-row"><div class="ap-cell-name">${nameMarkup}</div>`,
    `<div class="ap-cell-pill">${HtmlEscapeUtil.escapeHtml(timeText)}</div>`,
    `<div class="ap-cell-track">${trackMarkup}</div></div>`,
  ].join('');
}

function filedNameMarkup(ticket: PageTicket, input: TicketTimelineInput): string {
  const { limits, todayCalendarDate } = input;
  if (TimeUtil.stampIsFromDay(ticket.filed, todayCalendarDate, limits)) {
    return `<span class="ap-name">Filed <span class="mono">${HtmlEscapeUtil.escapeHtml(TimeUtil.shortStampText(ticket.filed, todayCalendarDate, limits))}</span></span>`;
  }
  return `<span class="ap-name" ${MarkupUtil.attribute('title', `filed ${TimeUtil.fullStampText(ticket.filed, limits)}`)}>Filed</span>`;
}

function filedRowMarkup(timeline: TicketTimeline, input: TicketTimelineInput): string {
  const { queue, axis } = timeline;
  const queued          = TicketTimelineUtil.durationTextOf(queue.endEpochMilliseconds - queue.startEpochMilliseconds, input.limits);
  const title           = `filed ${TimeUtil.fullStampText(input.ticket.filed, input.limits)} · in the queue ${queued}${queue.isLive ? ' so far' : ''}`;
  const bar             = `<div class="ap-bar ap-ticket-gantt-filed" style="${barStyle(axis, queue, input.limits)}" ${MarkupUtil.attribute('title', title)}></div>`;
  return ganttRowMarkup(filedNameMarkup(input.ticket, input), timeline.queueTimeText, bar);
}

function buildRowMarkup(timeline: TicketTimeline, input: TicketTimelineInput): string {
  const rowId    = timeline.ownRowId === null ? '' : ` <span class="mono">#${HtmlEscapeUtil.escapeHtml(String(timeline.ownRowId))}</span>`;
  const segments = timeline.buildSegments.map((segment) => [
    `<div class="ap-bar ap-bar-segment" ${MarkupUtil.attribute('data-state', segment.state)}${liveAttribute(segment)}`,
    ` style="${barStyle(timeline.axis, segment, input.limits)}" ${MarkupUtil.attribute('title', spanTitle(segment, segment.label, input))}></div>`,
  ].join('')).join('');
  return ganttRowMarkup(`<span class="ap-name">Build${rowId}</span>`, timeline.buildTimeText, segments);
}

function reviewRowMarkup(review: ReviewSpan, timeline: TicketTimeline, input: TicketTimelineInput): string {
  const tokens = review.tokens === null ? '' : ` · ${TokenCountUtil.formatTokenCount(review.tokens)} tokens`;
  const bar    = [
    `<div class="ap-bar" ${MarkupUtil.attribute('data-state', review.state)}${liveAttribute(review)} style="${barStyle(timeline.axis, review, input.limits)}"`,
    ` ${MarkupUtil.attribute('title', `${spanTitle(review, review.label, input)}${tokens}`)}></div>`,
  ].join('');
  return ganttRowMarkup(
    `<span class="ap-name">${HtmlEscapeUtil.escapeHtml(review.label)}</span>`,
    TicketTimelineUtil.durationTextOf(review.endEpochMilliseconds - review.startEpochMilliseconds, input.limits),
    bar,
  );
}

function afterBuildRowMarkup(timeline: TicketTimeline, input: TicketTimelineInput): string {
  const { afterBuild, axis } = timeline;
  const first                = afterBuild[0];
  const last                 = afterBuild.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }
  const segments = afterBuild.map((segment) => {
    const widthPercent = TicketTimelineUtil.percentAlong(axis, segment.endEpochMilliseconds) - TicketTimelineUtil.percentAlong(axis, segment.startEpochMilliseconds);
    const label        = widthPercent >= SEGMENT_LABEL_MINIMUM_PERCENT ? HtmlEscapeUtil.escapeHtml(segment.label) : '';
    return [
      `<div class="ap-bar ap-lifecycle-segment" ${MarkupUtil.attribute('data-state', segment.state)} style="${barStyle(axis, segment, input.limits)}"`,
      ` ${MarkupUtil.attribute('title', spanTitle(segment, segment.label, input))}>${label}</div>`,
    ].join('');
  }).join('');
  const afterBuildTimeText = TicketTimelineUtil.durationTextOf(last.endEpochMilliseconds - first.startEpochMilliseconds, input.limits);
  return ganttRowMarkup('<span class="ap-name">After build</span>', afterBuildTimeText, segments);
}

function legendMarkup(legend: readonly LegendEntry[]): string {
  const items = legend.map((entry) => [
    `<li><span class="ap-ticket-gantt-swatch" ${MarkupUtil.attribute('data-state', entry.state)}></span>`,
    `<b>${HtmlEscapeUtil.escapeHtml(entry.label)}</b><time>${HtmlEscapeUtil.escapeHtml(entry.durationText)}</time></li>`,
  ].join('')).join('');
  return `<ul class="ap-ticket-gantt-legend" aria-label="Time spent in each state">${items}</ul>`;
}

/** The chart, its legend and, for a ticket that never started, its note: the Timeline section's body. */
export function ticketTimelineMarkup(input: TicketTimelineInput): string {
  const timeline      = ticketTimelineOf(input);
  const { end }       = timeline;
  const endState      = end.closedState === null ? '' : ` ${MarkupUtil.attribute('data-state', end.closedState)}`;
  const endLeft       = `left:${MarkupUtil.percentText(end.leftPercent)}`;
  const ticks         = timeline.ticks
    .map((tick) => `<div class="ap-tick" style="left:${MarkupUtil.percentText(tick.leftPercent)}"><span>${HtmlEscapeUtil.escapeHtml(tick.label)}</span></div>`)
    .join('');
  const gridLines     = timeline.ticks.map((tick) => `<div class="ap-grid-line" style="left:${MarkupUtil.percentText(tick.leftPercent)}"></div>`).join('');
  const rows          = [
    filedRowMarkup(timeline, input),
    buildRowMarkup(timeline, input),
    ...timeline.reviews.map((review) => reviewRowMarkup(review, timeline, input)),
    afterBuildRowMarkup(timeline, input),
  ].join('');
  return [
    '<div class="ap-ticket-gantt"><div class="ap-grid-row ap-chart-head"><div class="ap-cell-name">Row</div><div class="ap-cell-pill">Time</div>',
    `<div class="ap-cell-track" style="height:100%"><div class="ap-ticket-gantt-ticks">${ticks}`,
    `<span class="ap-ticket-gantt-end-label"${endState} style="${endLeft}">${HtmlEscapeUtil.escapeHtml(end.label)}</span></div></div></div>`,
    `<div class="ap-body"><div class="ap-ticket-gantt-overlay">${gridLines}<div class="ap-ticket-gantt-end"${endState} style="${endLeft}"></div></div>`,
    `${rows}</div></div>`,
    legendMarkup(timeline.legend),
    timeline.note === null ? '' : `<p class="ap-ticket-gantt-note">${HtmlEscapeUtil.escapeHtml(timeline.note)}</p>`,
  ].join('');
}
