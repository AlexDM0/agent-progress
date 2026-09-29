/**
 * The Progress tab's markup: the task rows, the axis layer and the notes, shaped by the placeholder content of
 * `resources/template.html`. Every tracker value passes `escapeHtml` exactly once here.
 */

import { HtmlEscapeUtil }                 from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                 from '../../src/lib/token-count/TokenCountUtil.ts';
import { FIRST_REPEAT_REVIEW_ROUND }      from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { PageLimits }                from '../../src/shared/@types/PagePayload.ts';
import type { BoardRow }                  from '../@types/PageBoard.ts';
import type { TimelineBar, TimelineTick } from '../@types/Timeline.ts';
import type { ShortenedText }             from '../utils/MarkupUtil.ts';
import { MarkupUtil }                     from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                 from '../utils/TemplateIdUtil.ts';
import type { TimestampSlices }           from '../utils/TimeUtil.ts';
import { TimeUtil }                       from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }             from '../utils/WorkItemMarkupUtil.ts';
import { TICK_LABEL_GUTTER_PIXELS }       from './constants/ProgressChart.ts';

export interface TaskRow {
  task:      BoardRow;
  bar:       TimelineBar;
  waitingOn: readonly string[];
}

export interface PlacedTick extends TimelineTick {
  labelSitsLeftOfItsLine: boolean;
}

export interface TaskRowsDrawing {
  slices:             TimestampSlices;
  todayCalendarDate:  string;
  /** Off by default: each review pass with its ticket's row among these is drawn as a segment on that row instead of a row of its own. */
  reviewRowsAreShown: boolean;
}

interface PlacedTaskRow {
  row:              TaskRow;
  /** The ticket id of the row this one is nested with, drawn directly above it, or `null` for a row drawn at the top level. */
  nestedWithTicket: string | null;
  /** The review passes drawn on this row's track, oldest filed first. */
  reviewSegments:   readonly TaskRow[];
}

const LEADING_TICKET_NUMBER_PATTERN = /^#(\d+)\s+/;

/** Only the prefix is read, as when the bar was filed: `Review 2 #13, #5 — …` is round 2. */
const REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #\d+/;

/** A name that gives no round sorts above every numbered round. */
function reviewRoundNamedBy(task: BoardRow): number {
  const round = Number(REVIEW_BAR_NAME_PATTERN.exec(task.name)?.[1]);
  return Number.isSafeInteger(round) ? round : Number.MAX_SAFE_INTEGER;
}

/**
 * Newest filed first, except that a review bar whose ticket's own row, as the Board answers it, is among these rows is a segment on that
 * row; with review rows shown it is drawn directly above that row instead, latest round its name gives first, a name without a round above
 * the rest, then newest filed first. A bar whose own row is not among these rows — none, or hidden as long done — stays where its filing
 * puts it.
 */
function taskRowsInDisplayOrder(rows: readonly TaskRow[], reviewRowsAreShown: boolean): PlacedTaskRow[] {
  const rowByTask = new Map(rows.map((row) => [row.task, row]));

  const reviewsByParent = new Map<TaskRow, TaskRow[]>();
  for (const row of rows) {
    const parent = row.task.ownRowOfReviewedTicket === null ? undefined : rowByTask.get(row.task.ownRowOfReviewedTicket);
    if (parent !== undefined) reviewsByParent.set(parent, [...reviewsByParent.get(parent) ?? [], row]);
  }
  const nestedRows = new Set([...reviewsByParent.values()].flat());

  return rows.toReversed().flatMap((row): PlacedTaskRow[] => {
    if (nestedRows.has(row)) return [];
    const reviews = reviewsByParent.get(row) ?? [];
    if (!reviewRowsAreShown) return [{ row, nestedWithTicket: null, reviewSegments: reviews }];
    const reviewsLatestRoundFirst = reviews.toSorted((a, b) => reviewRoundNamedBy(b.task) - reviewRoundNamedBy(a.task) || b.task.id - a.task.id);
    return [
      ...reviewsLatestRoundFirst.map((review) => ({ row: review, nestedWithTicket: row.task.ticket, reviewSegments: [] })),
      { row, nestedWithTicket: null, reviewSegments: [] },
    ];
  });
}

/** The badge already shows the ticket, so a name opening with the same `#NNN` drops it; the title keeps the full name. */
function displayedNameOf(task: BoardRow): string {
  const leadingNumber = LEADING_TICKET_NUMBER_PATTERN.exec(task.name);
  if (task.ticket === null || leadingNumber === null || Number(leadingNumber[1]) !== Number(task.ticket)) {
    return task.name;
  }
  return task.name.slice(leadingNumber[0].length);
}

/** Rounds count the started passes oldest filed first, as the detail Timeline counts them. */
function reviewSegmentsMarkup(reviews: readonly TaskRow[], drawing: TaskRowsDrawing): string {
  const startedReviews = reviews.flatMap((review) => (review.task.start === null ? [] : [{ review, start: review.task.start }]));
  return startedReviews.map(({ review, start }, index) => {
    const round         = index + 1;
    const { task, bar } = review;
    if (!bar.visible) {
      return '';
    }
    const endText = task.end === null ? 'now' : TimeUtil.shortStampText(task.end, drawing.todayCalendarDate, drawing.slices);
    const title   = `Review ${round} · ${TimeUtil.shortStampText(start, drawing.todayCalendarDate, drawing.slices)} → ${endText}`;
    return [
      `<div class="ap-bar ap-bar-review" ${MarkupUtil.attribute('data-state', round === 1 ? 'reviewing' : 're-review')}${task.end === null ? ' data-live' : ''}`,
      ` style="left:${MarkupUtil.percentText(bar.leftPercent)};width:${MarkupUtil.percentText(bar.widthPercent)}" ${MarkupUtil.attribute('title', title)}></div>`,
    ].join('');
  }).join('');
}

function taskRowMarkup(placed: PlacedTaskRow, drawing: TaskRowsDrawing): string {
  const { row, nestedWithTicket, reviewSegments } = placed;
  const { task, bar }                              = row;
  const { slices }                                 = drawing;
  const state         = task.displayState;
  const pillLabel     = WorkItemMarkupUtil.stateLabelOf(state, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
  const ticketBadge   = task.ticket === null ? '' : WorkItemMarkupUtil.ticketBadgeMarkup(task.ticket);
  const reviewedMark = task.deliveredRowCountsAsReviewed ? WorkItemMarkupUtil.reviewedMarkMarkup(task, slices) : '';
  const tokens = task.tokens === null
    ? ''
    : `<span class="ap-tokens">${HtmlEscapeUtil.escapeHtml(TokenCountUtil.formatTokenCount(task.tokens))} tokens</span>`;
  const nesting    = nestedWithTicket === null ? '' : ` ${MarkupUtil.attribute('data-review-of', nestedWithTicket)}`;
  const identities = `${MarkupUtil.attribute('id', TemplateIdUtil.taskRowElementIdOf(task.id))} ${MarkupUtil.attribute('data-task-id', String(task.id))}`;
  const drawnBars    = [bar, ...reviewSegments.map((review) => review.bar)].filter((drawnBar) => drawnBar.visible);
  const clippedLeft  = drawnBars.some((drawnBar) => drawnBar.clippedLeft);
  const clippedRight = drawnBars.some((drawnBar) => drawnBar.clippedRight);
  return [
    `<div class="ap-grid-row ap-row" tabindex="0" ${identities} ${MarkupUtil.attribute('data-state', state)}${nesting}>`,
    `<div class="ap-cell-name"><span class="ap-num">${HtmlEscapeUtil.escapeHtml(String(task.id))}</span>`,
    `<span class="ap-name" ${MarkupUtil.attribute('title', task.name)}>${HtmlEscapeUtil.escapeHtml(displayedNameOf(task))}</span>`,
    `${ticketBadge}${WorkItemMarkupUtil.waitingOnMarkup(row.waitingOn)}${tokens}</div>`,
    `<div class="ap-cell-pill"><span class="ap-pill">${HtmlEscapeUtil.escapeHtml(pillLabel)}</span>${reviewedMark}</div>`,
    `<div class="ap-cell-track"><span class="ap-clip-l"${clippedLeft ? '' : ' hidden'}></span>`,
    `<div class="ap-bar"${bar.visible ? '' : ' hidden'} style="left:${MarkupUtil.percentText(bar.leftPercent)};width:${MarkupUtil.percentText(bar.widthPercent)}"></div>`,
    `${reviewSegmentsMarkup(reviewSegments, drawing)}<span class="ap-clip-r"${clippedRight ? '' : ' hidden'}></span></div>`,
    '</div>',
  ].join('');
}

/** Rows arrive in filing order and are drawn in `taskRowsInDisplayOrder`. */
export function taskRowsMarkup(rows: readonly TaskRow[], drawing: TaskRowsDrawing): string {
  return taskRowsInDisplayOrder(rows, drawing.reviewRowsAreShown).map((placed) => taskRowMarkup(placed, drawing)).join('');
}

export function tickLayerMarkup(ticks: readonly PlacedTick[]): string {
  return ticks.map((tick) => {
    const labelStyle = tick.labelSitsLeftOfItsLine ? ` style="left:auto;right:${TICK_LABEL_GUTTER_PIXELS}px"` : '';
    return `<div class="ap-tick" style="left:${MarkupUtil.percentText(tick.leftPercent)}"><span${labelStyle}>${HtmlEscapeUtil.escapeHtml(tick.label)}</span></div>`;
  }).join('');
}

export function overlayMarkup(ticks: readonly TimelineTick[], nowPercent: number | null, nowLabelSitsLeftOfMarker: boolean): string {
  const gridLines = ticks
    .map((tick) => `<div class="ap-grid-line" style="left:${MarkupUtil.percentText(tick.leftPercent)}"></div>`)
    .join('');
  const labelSide = nowLabelSitsLeftOfMarker ? ' data-label-side="left"' : '';
  const nowMarker = nowPercent === null
    ? '<div id="ap-now" hidden></div>'
    : `<div id="ap-now"${labelSide} style="--now-x:${MarkupUtil.percentText(nowPercent)}"></div>`;
  return `${gridLines}${nowMarker}`;
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

const FITTED_RANGE_TITLE = 'Fitted to the rows shown; re-fits when the finished-work switch changes';
const HELD_RANGE_TITLE   = 'Held: this range stays when the finished-work switch changes; Fit follows the rows again';

/** The range note led by its mode: "Fit", or the held preset ("4h") or "Custom" in the held colour. */
export function rangeNoteMarkup(modeLabel: string, modeIsHeld: boolean, note: ShortenedText): string {
  const mode = `<span class="ap-range-mode"${modeIsHeld ? ' data-held' : ''} ${MarkupUtil.attribute('title', modeIsHeld ? HELD_RANGE_TITLE : FITTED_RANGE_TITLE)}>`
    + `${HtmlEscapeUtil.escapeHtml(modeLabel)}</span>`;
  return `${mode} · ${HtmlEscapeUtil.escapeHtml(note.text)}`;
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
