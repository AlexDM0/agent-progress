/**
 * The Progress tab's markup: the task rows, the axis layer and the notes, shaped by the placeholder content of
 * `resources/template.html`. Every tracker value passes `escapeHtml` exactly once here.
 */

import { HtmlEscapeUtil }                               from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                               from '../../src/lib/token-count/TokenCountUtil.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                    from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { PageLimits }                              from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic, BoardRow }                     from '../@types/PageBoard.ts';
import type { ResolvedSpan, TimelineBar, TimelineTick } from '../@types/Timeline.ts';
import { NO_EPIC_CHIP }                                 from '../constants/EpicChips.ts';
import { EpicMarkup }                                   from '../epics/EpicMarkup.ts';
import { BarPhaseUtil }                                 from '../utils/BarPhaseUtil.ts';
import type { ShortenedText }                           from '../utils/MarkupUtil.ts';
import { MarkupUtil }                                   from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                               from '../utils/TemplateIdUtil.ts';
import type { TimestampSlices }                         from '../utils/TimeUtil.ts';
import { TimeUtil }                                     from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }                           from '../utils/WorkItemMarkupUtil.ts';
import { TICK_LABEL_GUTTER_PIXELS }                     from './constants/ProgressChart.ts';

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
  /** Null on a board without epics, whose rows are drawn ungrouped. */
  epicGrouping?:      EpicGrouping | null;
}

/** The rows grouped under a head row per epic, each ticket under its primary epic, then the rows in none under "No epic". */
export interface EpicGrouping {
  /** In the order the groups are drawn. */
  epics:                   readonly BoardEpic[];
  /** Each ticket's epics the board knows, its primary epic first. */
  epicsOfTicket:           ReadonlyMap<string, readonly BoardEpic[]>;
  /** Epic keys, and `NO_EPIC_CHIP`, whose rows are folded away under their head. */
  foldedGroupKeys:         ReadonlySet<string>;
  axis:                    ResolvedSpan;
  nowEpochMilliseconds:    number;
  minimumSpanWidthPercent: number;
}

interface PlacedTaskRow {
  row:              TaskRow;
  /** The ticket id of the row this one is nested with, drawn directly above it, or `null` for a row drawn at the top level. */
  nestedWithTicket: string | null;
  /** For a review pass drawn as a row of its own, its round from 1; `null` for every other row. */
  reviewPassRound:  number | null;
  /** The started review passes drawn on this row's track, oldest filed first. */
  reviewSegments:   readonly NumberedReview[];
}

interface NumberedReview {
  review: TaskRow;
  round:  number;
}

/** Rounds count the started passes oldest filed first, as the detail Timeline counts them. */
function startedReviewsNumbered(reviews: readonly TaskRow[]): NumberedReview[] {
  return reviews.filter((review) => review.task.start !== null).map((review, index) => ({ review, round: index + 1 }));
}

/** A review whose ticket's row is not drawn takes the round it was filed as. */
function roundOfUnnestedRow(task: BoardRow): number | null {
  return task.reviewOf === undefined && task.ownRowOfReviewedTicket === null ? null : task.reviewBarRound ?? 1;
}

const LEADING_TICKET_NUMBER_PATTERN = /^#(\d+)\s+/;

const FOLD_CARET = '▾';

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
    const numberedReviews = startedReviewsNumbered(reviewsByParent.get(row) ?? []);
    const ownRow          = { row, nestedWithTicket: null, reviewPassRound: roundOfUnnestedRow(row.task) };
    if (!reviewRowsAreShown) return [{ ...ownRow, reviewSegments: numberedReviews }];
    const roundByReview           = new Map(numberedReviews.map(({ review, round }) => [review, round]));
    const reviews                 = reviewsByParent.get(row) ?? [];
    const reviewsLatestRoundFirst = reviews.toSorted((a, b) => reviewRoundNamedBy(b.task) - reviewRoundNamedBy(a.task) || b.task.id - a.task.id);
    return [
      ...reviewsLatestRoundFirst.map((review) => ({
        row:              review,
        nestedWithTicket: row.task.ticket,
        reviewPassRound:  roundByReview.get(review) ?? 1,
        reviewSegments:   [],
      })),
      { ...ownRow, reviewSegments: [] },
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

function placementStyle(placed: { leftPercent: number; widthPercent: number }): string {
  return `style="left:${MarkupUtil.percentText(placed.leftPercent)};width:${MarkupUtil.percentText(placed.widthPercent)}"`;
}

function reviewSegmentsMarkup(reviews: readonly NumberedReview[], drawing: TaskRowsDrawing): string {
  return reviews.map(({ review, round }) => {
    const { task, bar } = review;
    if (!bar.visible || task.start === null) {
      return '';
    }
    const endText = task.end === null ? 'now' : TimeUtil.shortStampText(task.end, drawing.todayCalendarDate, drawing.slices);
    const title   = `Review ${round} · ${TimeUtil.shortStampText(task.start, drawing.todayCalendarDate, drawing.slices)} → ${endText}`;
    return [
      `<div class="ap-bar ap-bar-review" ${MarkupUtil.attribute('data-state', BarPhaseUtil.segmentStateOf(task.status, round))}${task.end === null ? ' data-live' : ''}`,
      ` ${placementStyle(bar)} ${MarkupUtil.attribute('title', title)}></div>`,
    ].join('');
  }).join('');
}

/**
 * Each stretch of the row's own bar in the state of the phase it shows, never the row's current one: a review pass in its round's fill, a
 * build in its recorded phases. A row with no recorded phase keeps the one bar in the row's state.
 */
function ownBarMarkup(task: BoardRow, bar: TimelineBar, reviewPassRound: number | null): string {
  if (bar.visible && reviewPassRound !== null) {
    const state = BarPhaseUtil.segmentStateOf(task.status, reviewPassRound);
    return `<div class="ap-bar ap-bar-segment" ${MarkupUtil.attribute('data-state', state)}${task.end === null ? ' data-live' : ''} ${placementStyle(bar)}></div>`;
  }
  if (bar.phases.length === 0) {
    return `<div class="ap-bar"${bar.visible ? '' : ' hidden'} ${placementStyle(bar)}></div>`;
  }
  return bar.phases.map((phase) => {
    const state = BarPhaseUtil.segmentStateOf(phase.status, null);
    return `<div class="ap-bar ap-bar-segment" ${MarkupUtil.attribute('data-state', state)}${phase.isLive ? ' data-live' : ''} ${placementStyle(phase)}></div>`;
  }).join('');
}

function taskRowMarkup(placed: PlacedTaskRow, drawing: TaskRowsDrawing, otherEpicSquares = ''): string {
  const {
    row,
    nestedWithTicket,
    reviewPassRound,
    reviewSegments,
  } = placed;
  const { task, bar } = row;
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
  const drawnBars    = [bar, ...reviewSegments.map(({ review }) => review.bar)].filter((drawnBar) => drawnBar.visible);
  const clippedLeft  = drawnBars.some((drawnBar) => drawnBar.clippedLeft);
  const clippedRight = drawnBars.some((drawnBar) => drawnBar.clippedRight);
  return [
    `<div class="ap-grid-row ap-row" tabindex="0" ${identities} ${MarkupUtil.attribute('data-state', state)}${nesting}>`,
    `<div class="ap-cell-name"><span class="ap-num">${HtmlEscapeUtil.escapeHtml(String(task.id))}</span>`,
    `<span class="ap-name" ${MarkupUtil.attribute('title', task.name)}>${HtmlEscapeUtil.escapeHtml(displayedNameOf(task))}</span>`,
    `${ticketBadge}${WorkItemMarkupUtil.waitingOnMarkup(row.waitingOn)}${tokens}${otherEpicSquares}</div>`,
    `<div class="ap-cell-pill"><span class="ap-pill">${HtmlEscapeUtil.escapeHtml(pillLabel)}</span>${reviewedMark}</div>`,
    `<div class="ap-cell-track"><span class="ap-clip-l"${clippedLeft ? '' : ' hidden'}></span>`,
    ownBarMarkup(task, bar, reviewPassRound),
    `${reviewSegmentsMarkup(reviewSegments, drawing)}<span class="ap-clip-r"${clippedRight ? '' : ' hidden'}></span></div>`,
    '</div>',
  ].join('');
}

/** A review row goes with the ticket it reviews; a free-standing row has no ticket. */
function ticketIdOfRow(task: BoardRow): string | null {
  return task.ticket ?? task.ownRowOfReviewedTicket?.ticket ?? task.reviewOf ?? null;
}

function groupKeyOf(task: BoardRow, grouping: EpicGrouping): string {
  const ticketId = ticketIdOfRow(task);
  const primary  = ticketId === null ? undefined : grouping.epicsOfTicket.get(ticketId)?.[0];
  return primary?.key ?? NO_EPIC_CHIP;
}

/** The epic's span on the axis from its roll-up, nothing when it never started or lies wholly outside the range. */
function epicSpanMarkup(epic: BoardEpic, grouping: EpicGrouping, drawing: TaskRowsDrawing): string {
  const { span } = epic;
  if (span === null) {
    return '';
  }
  const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(span.start);
  const endEpochMilliseconds   = span.end === null ? grouping.nowEpochMilliseconds : TimeUtil.epochMillisecondsOf(span.end);
  if (startEpochMilliseconds === null || endEpochMilliseconds === null) {
    return '';
  }
  const { axis }         = grouping;
  const axisMilliseconds = axis.toEpochMilliseconds - axis.fromEpochMilliseconds;
  const rawLeftPercent   = (startEpochMilliseconds - axis.fromEpochMilliseconds) / axisMilliseconds * 100;
  const rawRightPercent  = (Math.max(startEpochMilliseconds, endEpochMilliseconds) - axis.fromEpochMilliseconds) / axisMilliseconds * 100;
  if (rawRightPercent < 0 || rawLeftPercent > 100) {
    return '';
  }
  const widthPercent = Math.min(100, Math.max(Math.min(rawRightPercent, 100) - Math.max(rawLeftPercent, 0), grouping.minimumSpanWidthPercent));
  const leftPercent  = Math.max(0, Math.min(Math.max(rawLeftPercent, 0), 100 - widthPercent));
  const endText      = span.end === null ? 'now' : TimeUtil.shortStampText(span.end, drawing.todayCalendarDate, drawing.slices);
  const title        = `${epic.title} · ${TimeUtil.shortStampText(span.start, drawing.todayCalendarDate, drawing.slices)} → ${endText}`;
  const openMark     = EpicMarkup.openTicketCountOf(epic) > 0 ? ' data-open' : '';
  return `<div class="ap-epic-span"${openMark} ${placementStyle({ leftPercent, widthPercent })} ${MarkupUtil.attribute('title', title)}></div>`;
}

function headRowOpeningMarkup(groupKey: string, folded: boolean, extraAttributes: string): string {
  return `<div class="ap-grid-row ap-row ap-epic-head-row" tabindex="0" ${MarkupUtil.attribute('data-epic-key', groupKey)}${extraAttributes}`
    + ` aria-expanded="${String(!folded)}"${folded ? ' data-collapsed' : ''}>`
    + `<div class="ap-cell-name"><span class="ap-epic-caret" aria-hidden="true">${FOLD_CARET}</span>`;
}

/** Shared tickets are the epic's tickets drawn under another, primary, epic; its span counts them all the same. */
function epicHeadRowMarkup(epic: BoardEpic, grouping: EpicGrouping, drawing: TaskRowsDrawing): string {
  const sharedCount = epic.ticketIds.filter((ticketId) => grouping.epicsOfTicket.get(ticketId)?.[0]?.key !== epic.key).length;
  const sharedNote  = sharedCount === 0
    ? ''
    : ` <span class="ap-epic-head-count" ${MarkupUtil.attribute('title', `${sharedCount} of its tickets show under another epic`)}>+${sharedCount} shared</span>`;
  return [
    headRowOpeningMarkup(epic.key, grouping.foldedGroupKeys.has(epic.key), ` ${MarkupUtil.attribute('data-epic-slot', String(epic.slot))}`),
    `${EpicMarkup.epicChipsMarkup([epic])}${sharedNote}</div>`,
    `<div class="ap-cell-pill">${EpicMarkup.doneTicketCountOf(epic)} / ${epic.ticketIds.length} done</div>`,
    `<div class="ap-cell-track">${epicSpanMarkup(epic, grouping, drawing)}</div>`,
    '</div>',
  ].join('');
}

function noEpicHeadRowMarkup(memberCount: number, grouping: EpicGrouping): string {
  return `${headRowOpeningMarkup(NO_EPIC_CHIP, grouping.foldedGroupKeys.has(NO_EPIC_CHIP), '')}No epic <span class="ap-epic-head-count">${memberCount}</span></div>`
    + '<div class="ap-cell-pill"></div><div class="ap-cell-track"></div></div>';
}

/** A member row of a ticket in more than one epic carries the squares of the epics it is not drawn under; a review row leaves them to its ticket's. */
function memberRowMarkup(placed: PlacedTaskRow, grouping: EpicGrouping, drawing: TaskRowsDrawing): string {
  const { task }    = placed.row;
  const otherEpics  = task.ticket === null ? [] : grouping.epicsOfTicket.get(task.ticket)?.slice(1) ?? [];
  return taskRowMarkup(placed, drawing, EpicMarkup.otherEpicSquaresMarkup(otherEpics));
}

function groupedTaskRowsMarkup(placedRows: readonly PlacedTaskRow[], grouping: EpicGrouping, drawing: TaskRowsDrawing): string {
  const membersByGroup = new Map<string, PlacedTaskRow[]>();
  for (const placed of placedRows) {
    const groupKey = groupKeyOf(placed.row.task, grouping);
    membersByGroup.set(groupKey, [...membersByGroup.get(groupKey) ?? [], placed]);
  }
  const groups: Array<{ key: string; epic: BoardEpic | null }> = [
    ...grouping.epics.map((epic) => ({ key: epic.key, epic })),
    { key: NO_EPIC_CHIP, epic: null },
  ];
  return groups.flatMap(({ key, epic }) => {
    const members = membersByGroup.get(key) ?? [];
    if (members.length === 0) {
      return [];
    }
    const head       = epic === null ? noEpicHeadRowMarkup(members.length, grouping) : epicHeadRowMarkup(epic, grouping, drawing);
    const shownRows  = grouping.foldedGroupKeys.has(key) ? [] : members.map((placed) => memberRowMarkup(placed, grouping, drawing));
    return [head, ...shownRows];
  }).join('');
}

/** Rows arrive in filing order and are drawn in `taskRowsInDisplayOrder`, under their epics' head rows on a board with epics. */
export function taskRowsMarkup(rows: readonly TaskRow[], drawing: TaskRowsDrawing): string {
  const placedRows = taskRowsInDisplayOrder(rows, drawing.reviewRowsAreShown);
  const grouping   = drawing.epicGrouping ?? null;
  if (grouping === null) {
    return placedRows.map((placed) => taskRowMarkup(placed, drawing)).join('');
  }
  return groupedTaskRowsMarkup(placedRows, grouping, drawing);
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
