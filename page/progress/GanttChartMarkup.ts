/**
 * The Progress tab's markup: the task rows, the axis layer, the summary and the notes, shaped by the placeholder content of
 * `resources/template.html`. Every tracker value passes `escapeHtml` exactly once here.
 */

import { HtmlEscapeUtil }                   from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                   from '../../src/lib/token-count/TokenCountUtil.ts';
import type { Task }                        from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }        from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { SETTLED_TASK_STATUSES }            from '../../src/lib/tracker-model/constants/Statuses.ts';
import type { PageConcurrency, PageLimits } from '../../src/shared/@types/PagePayload.ts';
import type { BoardRow }                    from '../@types/PageBoard.ts';
import type { TimelineBar, TimelineTick }   from '../@types/Timeline.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }    from '../constants/StateLabels.ts';
import type { ShortenedText }               from '../utils/MarkupUtil.ts';
import { MarkupUtil }                       from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                   from '../utils/TemplateIdUtil.ts';
import type { TimestampSlices }             from '../utils/TimeUtil.ts';
import { TimeUtil }                         from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }               from '../utils/WorkItemMarkupUtil.ts';
import { TICK_LABEL_GUTTER_PIXELS }         from './constants/ProgressChart.ts';

export interface TaskRow {
  task:      BoardRow;
  bar:       TimelineBar;
  waitingOn: readonly string[];
}

export interface PlacedTick extends TimelineTick {
  labelSitsLeftOfItsLine: boolean;
}

interface PlacedTaskRow {
  row:              TaskRow;
  /** The ticket id of the row this one is nested with, drawn directly above it, or `null` for a row drawn at the top level. */
  nestedWithTicket: string | null;
}

/** Only the prefix is read, as when the bar was filed: `Review 2 #13, #5 — …` is round 2. */
const REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #\d+/;

/** A name that gives no round sorts above every numbered round. */
function reviewRoundNamedBy(task: BoardRow): number {
  const round = Number(REVIEW_BAR_NAME_PATTERN.exec(task.name)?.[1]);
  return Number.isSafeInteger(round) ? round : Number.MAX_SAFE_INTEGER;
}

/**
 * Newest filed first, except that a review bar is drawn directly above its ticket's own row, as the Board answers it, latest round its
 * name gives first, a name without a round above the rest, then newest filed first. A bar whose own row is not among these rows — none, or
 * hidden as long done — stays where its filing puts it.
 */
function taskRowsInDisplayOrder(rows: readonly TaskRow[]): PlacedTaskRow[] {
  const rowByTask = new Map(rows.map((row) => [row.task, row]));

  const reviewsByParent = new Map<TaskRow, TaskRow[]>();
  for (const row of rows) {
    const parent = row.task.ownRowOfReviewedTicket === null ? undefined : rowByTask.get(row.task.ownRowOfReviewedTicket);
    if (parent !== undefined) reviewsByParent.set(parent, [...reviewsByParent.get(parent) ?? [], row]);
  }
  const nestedRows = new Set([...reviewsByParent.values()].flat());

  return rows.toReversed().flatMap((row) => {
    if (nestedRows.has(row)) return [];
    const reviews = (reviewsByParent.get(row) ?? []).toSorted((a, b) => reviewRoundNamedBy(b.task) - reviewRoundNamedBy(a.task) || b.task.id - a.task.id);
    return [
      ...reviews.map((review) => ({ row: review, nestedWithTicket: row.task.ticket })),
      { row, nestedWithTicket: null },
    ];
  });
}

function taskRowMarkup(placed: PlacedTaskRow, slices: TimestampSlices): string {
  const { row, nestedWithTicket } = placed;
  const { task, bar }              = row;
  const state         = task.displayState;
  const pillLabel     = WorkItemMarkupUtil.stateLabelOf(state, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
  const ticketBadge   = task.ticket === null ? '' : WorkItemMarkupUtil.ticketBadgeMarkup(task.ticket);
  const reviewedMark = task.deliveredRowCountsAsReviewed ? WorkItemMarkupUtil.reviewedMarkMarkup(task, slices) : '';
  const tokens = task.tokens === null
    ? ''
    : `<span class="ap-tokens">${HtmlEscapeUtil.escapeHtml(TokenCountUtil.formatTokenCount(task.tokens))} tokens</span>`;
  const nesting    = nestedWithTicket === null ? '' : ` ${MarkupUtil.attribute('data-review-of', nestedWithTicket)}`;
  const identities = `${MarkupUtil.attribute('id', TemplateIdUtil.taskRowElementIdOf(task.id))} ${MarkupUtil.attribute('data-task-id', String(task.id))}`;
  return [
    `<div class="ap-grid-row ap-row" tabindex="0" ${identities} ${MarkupUtil.attribute('data-state', state)}${nesting}>`,
    `<div class="ap-cell-name"><span class="ap-num">${HtmlEscapeUtil.escapeHtml(String(task.id))}</span>`,
    `<span class="ap-name" ${MarkupUtil.attribute('title', task.name)}>${HtmlEscapeUtil.escapeHtml(task.name)}</span>`,
    `${ticketBadge}${WorkItemMarkupUtil.waitingOnMarkup(row.waitingOn)}${tokens}</div>`,
    `<div class="ap-cell-pill"><span class="ap-pill">${HtmlEscapeUtil.escapeHtml(pillLabel)}</span>${reviewedMark}</div>`,
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
    return `<div class="ap-tick" style="left:${MarkupUtil.percentText(tick.leftPercent)}"><span${labelStyle}>${HtmlEscapeUtil.escapeHtml(tick.label)}</span></div>`;
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
export function summaryStatisticsMarkup(tasks: readonly Task[], concurrency: PageConcurrency): string {
  const completedCount     = tasks.filter((task) => SETTLED_TASK_STATUSES.includes(task.status)).length;
  const awaitingMergeCount = tasks.filter((task) => task.status === 'reviewed').length;
  const inReviewCount      = tasks.filter((task) => task.status === 'in-review' || task.status === 're-review').length;
  const reportedTokens     = tasks.filter((task) => task.tokens !== null);
  const figureMarkup = (figure: string): string => `<span class="ap-stat-n">${HtmlEscapeUtil.escapeHtml(figure)}</span>`;
  const statistics = [
    `Work completed: ${figureMarkup(`${completedCount} / ${tasks.length}`)}`,
    `${figureMarkup(String(awaitingMergeCount))} ${STATE_LABEL_FOR_DISPLAY_STATE.reviewed.toLowerCase()}`,
    `${figureMarkup(String(inReviewCount))} in review`,
    `${figureMarkup(`${concurrency.agentsInFlight} of ${concurrency.limit}`)} ${concurrency.limit === 1 ? 'agent' : 'agents'} running`,
  ];
  if (reportedTokens.length > 0) {
    statistics.push(`${figureMarkup(TokenCountUtil.formatTokenCount(reportedTokens.reduce((total, task) => total + (task.tokens ?? 0), 0)))} tokens`);
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

/** Each end is shortened against the viewer's day on its own, unlike the tick labels, which the axis dates by the span it covers. */
export function rangeNoteText(
  fromEpochMilliseconds: number,
  toEpochMilliseconds: number,
  stepMinutes: number,
  todayCalendarDate: string,
  limits: Pick<PageLimits, 'hourMinutes' | 'dayMinutes'>,
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
