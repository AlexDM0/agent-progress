/**
 * The Progress tab's markup: the task rows, the axis layer, the summary and the notes, shaped by the placeholder content of
 * `resources/template.html`. Every tracker value passes `escapeHtml` exactly once here.
 */

import type { Task }                      from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }              from '../../src/lib/tracker-model/@types/Ticket.ts';
import { SETTLED_TASK_STATUSES }          from '../../src/lib/tracker-model/constants/Statuses.ts';
import { HtmlEscapeUtil }                 from '../../src/lib/utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }                 from '../../src/lib/utils/TokenCountUtil.ts';
import { LIMITS }                         from '../../src/shared/constants/Limits.ts';
import { TicketNumberUtil }               from '../../src/shared/utils/TicketNumberUtil.ts';
import type { RowState }                  from '../constants/RowState.ts';
import { PERCENT_OF_A_WHOLE }             from '../constants/Units.ts';
import { BoardRulesUtil }                 from '../utils/BoardRulesUtil.ts';
import type { TimelineBar, TimelineTick } from '../utils/GeometryUtil.ts';
import type { ShortenedText }             from '../utils/MarkupUtil.ts';
import { MarkupUtil }                     from '../utils/MarkupUtil.ts';
import type { TimestampSlices }           from '../utils/TimeUtil.ts';
import { TimeUtil }                       from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }             from '../utils/WorkItemMarkupUtil.ts';

const { escapeHtml }       = HtmlEscapeUtil;
const { formatTokenCount } = TokenCountUtil;

const TICK_MINIMUM_PIXELS             = 60;
const TICK_PIXELS_PER_LABEL_CHARACTER = 9;

const TICK_LABEL_GUTTER_PIXELS = 5;

export interface TaskRow {
  task:         Task;
  ticketStatus: TicketStatus | null;
  bar:          TimelineBar;
  waitingOn:    readonly string[];
}

export interface PlacedTick extends TimelineTick {
  labelSitsLeftOfItsLine: boolean;
}

export function axisPixelsNeededFor(ticks: readonly TimelineTick[]): number {
  const longestLabel  = ticks.reduce((longest, tick) => Math.max(longest, tick.label.length), 0);
  const perTickPixels = Math.max(TICK_MINIMUM_PIXELS, longestLabel * TICK_PIXELS_PER_LABEL_CHARACTER);
  return ticks.length * perTickPixels;
}

export function labelSitsLeftOfItsLine(tick: TimelineTick, axisWidthPixels: number): boolean {
  const remainingPixels = axisWidthPixels * (PERCENT_OF_A_WHOLE - tick.leftPercent) / PERCENT_OF_A_WHOLE;
  return remainingPixels < tick.label.length * TICK_PIXELS_PER_LABEL_CHARACTER + TICK_LABEL_GUTTER_PIXELS;
}

function pillLabelFor(state: RowState, task: Task): string {
  return WorkItemMarkupUtil.pillLabelForRowState(state, task.reviewRound ?? LIMITS.FIRST_REPEAT_REVIEW_ROUND);
}

interface PlacedTaskRow {
  row:              TaskRow;
  /** The ticket id of the row this one is nested with, drawn directly above it, or `null` for a row drawn at the top level. */
  nestedWithTicket: string | null;
}

/**
 * Newest filed first, except that a review row is drawn directly above its ticket's own row, latest round first. A review whose ticket has
 * no row among these — never started, or hidden as long done — stays where its filing puts it, and a ticket's own row is never nested.
 */
function taskRowsInDisplayOrder(rows: readonly TaskRow[]): PlacedTaskRow[] {
  const ownRowByTicketNumber = new Map<number, TaskRow>();
  for (const row of rows) {
    const ticketNumber = TicketNumberUtil.ticketNumberOf(row.task.ticket ?? undefined);
    if (ticketNumber !== null) ownRowByTicketNumber.set(ticketNumber, row);
  }

  const reviewsByParent = new Map<TaskRow, TaskRow[]>();
  for (const row of rows) {
    const reviewedNumber = row.task.ticket === null ? TicketNumberUtil.reviewedTicketNumberOf(row.task) : null;
    const parent         = reviewedNumber === null ? undefined : ownRowByTicketNumber.get(reviewedNumber);
    if (parent !== undefined) reviewsByParent.set(parent, [...reviewsByParent.get(parent) ?? [], row]);
  }
  const nestedRows = new Set([...reviewsByParent.values()].flat());

  return rows.toReversed().flatMap((row) => {
    if (nestedRows.has(row)) return [];
    const reviews = (reviewsByParent.get(row) ?? []).toSorted((a, b) => TicketNumberUtil.reviewRoundNamedBy(b.task) - TicketNumberUtil.reviewRoundNamedBy(a.task)
      || b.task.id - a.task.id);
    return [
      ...reviews.map((review) => ({ row: review, nestedWithTicket: row.task.ticket })),
      { row, nestedWithTicket: null },
    ];
  });
}

function taskRowMarkup(placed: PlacedTaskRow, slices: TimestampSlices): string {
  const { row, nestedWithTicket } = placed;
  const { task, bar }              = row;
  const state         = BoardRulesUtil.rowStateFor(task, row.ticketStatus);
  const ticketBadge   = task.ticket === null ? '' : WorkItemMarkupUtil.ticketBadgeMarkup(task.ticket);
  const reviewedMark = BoardRulesUtil.deliveredAfterReview(task, row.ticketStatus) ? WorkItemMarkupUtil.reviewedMarkMarkup(task, slices) : '';
  const tokens = task.tokens === null
    ? ''
    : `<span class="ap-tokens">${escapeHtml(formatTokenCount(task.tokens))} tokens</span>`;
  const nesting    = nestedWithTicket === null ? '' : ` ${MarkupUtil.attribute('data-review-of', nestedWithTicket)}`;
  const identities = `${MarkupUtil.attribute('id', `ap-task-${task.id}`)} ${MarkupUtil.attribute('data-task-id', String(task.id))}`;
  return [
    `<div class="ap-grid-row ap-row" tabindex="0" ${identities} ${MarkupUtil.attribute('data-state', state)}${nesting}>`,
    `<div class="ap-cell-name"><span class="ap-num">${escapeHtml(String(task.id))}</span>`,
    `<span class="ap-name" ${MarkupUtil.attribute('title', task.name)}>${escapeHtml(task.name)}</span>`,
    `${ticketBadge}${WorkItemMarkupUtil.waitingOnMarkup(row.waitingOn)}${tokens}</div>`,
    `<div class="ap-cell-pill"><span class="ap-pill">${escapeHtml(pillLabelFor(state, task))}</span>${reviewedMark}</div>`,
    `<div class="ap-cell-track"><span class="ap-clip-l"${bar.visible && bar.clippedLeft ? '' : ' hidden'}></span>`,
    `<div class="ap-bar"${bar.visible ? '' : ' hidden'} style="left:${MarkupUtil.percentText(bar.leftPercent)};width:${MarkupUtil.percentText(bar.widthPercent)}"></div>`,
    `<span class="ap-clip-r"${bar.visible && bar.clippedRight ? '' : ' hidden'}></span></div>`,
    '</div>',
  ].join('');
}

/** Rows arrive in filing order and are drawn in `taskRowsInDisplayOrder`. */
export function taskRowsMarkup(rows: readonly TaskRow[], slices: TimestampSlices): string {
  return taskRowsInDisplayOrder(rows).map((placed) => taskRowMarkup(placed, slices)).join('');
}

export function tickLayerMarkup(ticks: readonly PlacedTick[]): string {
  return ticks.map((tick) => {
    const labelStyle = tick.labelSitsLeftOfItsLine ? ` style="left:auto;right:${TICK_LABEL_GUTTER_PIXELS}px"` : '';
    return `<div class="ap-tick" style="left:${MarkupUtil.percentText(tick.leftPercent)}"><span${labelStyle}>${escapeHtml(tick.label)}</span></div>`;
  }).join('');
}

export function overlayMarkup(ticks: readonly TimelineTick[], nowPercent: number | null): string {
  const gridLines = ticks
    .map((tick) => `<div class="ap-grid-line" style="left:${MarkupUtil.percentText(tick.leftPercent)}"></div>`)
    .join('');
  const nowMarker = nowPercent === null
    ? '<div id="ap-now" hidden></div>'
    : `<div id="ap-now" style="--now-x:${MarkupUtil.percentText(nowPercent)}"></div>`;
  return `${gridLines}${nowMarker}`;
}

/** The token figure is left out entirely when no task reports one, because `null` means "nobody said" and `0 tokens` would be a claim. */
export function summaryStatisticsMarkup(tasks: readonly Task[], concurrency: { limit: number; agentsInFlight: number }): string {
  const completedCount     = tasks.filter((task) => SETTLED_TASK_STATUSES.includes(task.status)).length;
  const awaitingMergeCount = tasks.filter((task) => task.status === 'reviewed').length;
  const inReviewCount      = tasks.filter((task) => task.status === 'in-review' || task.status === 're-review').length;
  const reportedTokens     = tasks.filter((task) => task.tokens !== null);
  const figureMarkup = (figure: string): string => `<span class="ap-stat-n">${escapeHtml(figure)}</span>`;
  const statistics = [
    `Work completed: ${figureMarkup(`${completedCount} / ${tasks.length}`)}`,
    `${figureMarkup(String(awaitingMergeCount))} awaiting merge`,
    `${figureMarkup(String(inReviewCount))} in review`,
    `${figureMarkup(`${concurrency.agentsInFlight} of ${concurrency.limit}`)} ${concurrency.limit === 1 ? 'agent' : 'agents'} running`,
  ];
  if (reportedTokens.length > 0) {
    statistics.push(`${figureMarkup(formatTokenCount(reportedTokens.reduce((total, task) => total + (task.tokens ?? 0), 0)))} tokens`);
  }
  return statistics
    .map((statisticMarkup) => `<span class="ap-stat">${statisticMarkup}</span>`)
    .join('<span class="ap-sep">&middot;</span>');
}

export function generatedStampText(generatedAtEpochMilliseconds: number, todayCalendarDate: string): ShortenedText {
  return MarkupUtil.shortenedText(
    `generated ${TimeUtil.shortInstantText(generatedAtEpochMilliseconds, todayCalendarDate)}`,
    `generated ${TimeUtil.fullInstantText(generatedAtEpochMilliseconds)}`,
  );
}

function tickStepLabel(stepMinutes: number, hourMinutes: number, dayMinutes: number): string {
  if (dayMinutes > 0 && stepMinutes % dayMinutes === 0) {
    return `${stepMinutes / dayMinutes}d`;
  }
  if (hourMinutes > 0 && stepMinutes % hourMinutes === 0) {
    return `${stepMinutes / hourMinutes}h`;
  }
  return `${stepMinutes}m`;
}

export interface RangeNoteLimits {
  hourMinutes: number;
  dayMinutes:  number;
}

/** Each end is shortened against the viewer's day on its own, unlike the tick labels, which the axis dates by the span it covers. */
export function rangeNoteText(
  fromEpochMilliseconds: number,
  toEpochMilliseconds: number,
  stepMinutes: number,
  todayCalendarDate: string,
  limits: RangeNoteLimits,
): ShortenedText {
  const step      = `${tickStepLabel(stepMinutes, limits.hourMinutes, limits.dayMinutes)} ticks`;
  const shortEnds = `${TimeUtil.shortInstantText(fromEpochMilliseconds, todayCalendarDate)} \u2192 ${TimeUtil.shortInstantText(toEpochMilliseconds, todayCalendarDate)}`;
  const fullEnds  = `${TimeUtil.fullInstantText(fromEpochMilliseconds)} \u2192 ${TimeUtil.fullInstantText(toEpochMilliseconds)}`;
  return MarkupUtil.shortenedText(`${shortEnds} \u00b7 ${step}`, `${fullEnds} \u00b7 ${step}`);
}

export function hiddenWorkNoteText(hiddenTaskCount: number, hiddenTicketCount: number): string {
  const parts: string[] = [];
  if (hiddenTaskCount > 0) {
    parts.push(`${hiddenTaskCount} task${hiddenTaskCount === 1 ? '' : 's'}`);
  }
  if (hiddenTicketCount > 0) {
    parts.push(`${hiddenTicketCount} ticket${hiddenTicketCount === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? '' : `${parts.join(' · ')} hidden`;
}
