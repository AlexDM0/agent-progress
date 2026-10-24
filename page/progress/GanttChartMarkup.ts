/**
 * The Progress tab's markup: the task rows, the axis layer and the notes, shaped by the placeholder content of
 * `resources/template.html`. Every tracker value passes `escapeHtml` exactly once here.
 */

import { HtmlEscapeUtil }                               from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                               from '../../src/lib/token-count/TokenCountUtil.ts';
import type { DisplayState }                            from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }                              from '../../src/lib/tracker-model/@types/Ticket.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                    from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { PageLimits }                              from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic }                               from '../@types/PageBoard.ts';
import type { ResolvedSpan, TimelineBar, TimelineTick } from '../@types/Timeline.ts';
import type { TimelineRowSource }                       from '../@types/Timeline.ts';
import { BarPhaseUtil }                                 from '../utils/BarPhaseUtil.ts';
import type { ShortenedText }                           from '../utils/MarkupUtil.ts';
import { MarkupUtil }                                   from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                               from '../utils/TemplateIdUtil.ts';
import type { TimestampSlices }                         from '../utils/TimeUtil.ts';
import { TimeUtil }                                     from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }                           from '../utils/WorkItemMarkupUtil.ts';
import { rowGroupingOfEpics }                           from './EpicRowGrouping.ts';
import type { ChartGroupModel, RowGrouping }            from './RowGrouping.ts';
import type { UngroupedHead }                           from './RowGrouping.ts';
import { TICK_LABEL_GUTTER_PIXELS }                     from './constants/ProgressChart.ts';

/**
 * What a chart row reads: a name, a state and a span, which any row has, and the tracker's features, each optional and leaving its markup
 * out when absent.
 */
export interface ChartRowSource extends TimelineRowSource {
  name:                          string;
  displayState:                  DisplayState;
  /** The element id and `data-task-id`; set, the row draws its number cell, which shows its ticket and never this id. */
  id?:                           number;
  /** The ticket badge, and the `#NNN` the name drops beside it. */
  ticket?:                       string | null;
  /** The type mark after the ticket badge, on a ticket's own row only. */
  ticketType?:                   TicketType;
  tokens?:                       number | null;
  reviewRound?:                  number;
  reviewed?:                     string;
  deliveredRowCountsAsReviewed?: boolean;
  reviewOf?:                     string;
  reviewBarRound?:               number;
  /** For a review bar, its ticket's own row; absent or null for every other row. */
  ownRowOfReviewedTicket?:       ChartRowSource | null;
}

export interface TaskRow {
  task:                ChartRowSource;
  bar:                 TimelineBar;
  waitingOn:           readonly string[];
  /** Markup closing the name cell, after every tracker mark. */
  trailingNameMarkup?: string;
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
  /** Drawn in place of `epicGrouping` when set. */
  rowGrouping?:       RowGrouping<ChartRowSource> | null;
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
function roundOfUnnestedRow(task: ChartRowSource): number | null {
  return task.reviewOf === undefined && ownRowOfReviewedTicketOf(task) === null ? null : task.reviewBarRound ?? 1;
}

/** Left out, a row is no review bar: a row of another page never names one. */
function ownRowOfReviewedTicketOf(task: ChartRowSource): ChartRowSource | null {
  return task.ownRowOfReviewedTicket ?? null;
}

function ticketOf(task: ChartRowSource): string | null {
  return task.ticket ?? null;
}

const FOLD_CARET = '▾';

/** Only the prefix is read, as when the bar was filed: `Review 2 #13, #5 — …` is round 2. */
const REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #\d+/;

/** A name that gives no round sorts above every numbered round. */
function reviewRoundNamedBy(task: ChartRowSource): number {
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
    const ownRowOfReviewedTicket = ownRowOfReviewedTicketOf(row.task);
    const parent = ownRowOfReviewedTicket === null ? undefined : rowByTask.get(ownRowOfReviewedTicket);
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
    const reviewsLatestRoundFirst = reviews.toSorted((a, b) => reviewRoundNamedBy(b.task) - reviewRoundNamedBy(a.task) || (b.task.id ?? 0) - (a.task.id ?? 0));
    return [
      ...reviewsLatestRoundFirst.map((review) => ({
        row:              review,
        nestedWithTicket: ticketOf(row.task),
        reviewPassRound:  roundByReview.get(review) ?? 1,
        reviewSegments:   [],
      })),
      { ...ownRow, reviewSegments: [] },
    ];
  });
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
      `<div class="ap-bar ap-bar-review" ${MarkupUtil.attribute('data-state', BarPhaseUtil.reviewPassStateOf(round))}${task.end === null ? ' data-live' : ''}`,
      ` ${placementStyle(bar)} ${MarkupUtil.attribute('title', title)}></div>`,
    ].join('');
  }).join('');
}

/**
 * Each stretch of the row's own bar in the state of the phase it shows, never the row's current one: a review pass in its round's fill, a
 * build in its recorded phases. A row with no recorded phase keeps the one bar in the row's state.
 */
function ownBarMarkup(task: ChartRowSource, bar: TimelineBar, reviewPassRound: number | null): string {
  if (bar.visible && reviewPassRound !== null) {
    const state = BarPhaseUtil.reviewPassStateOf(reviewPassRound);
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

/** A row's own ticket links to it; a review bar names the ticket it reviews and a ticketless row reads "TASK", neither a link. */
function numberCellMarkup(task: ChartRowSource): string {
  const ticket = ticketOf(task);
  const label  = HtmlEscapeUtil.escapeHtml(WorkItemMarkupUtil.rowLabelOf(task));
  return ticket === null
    ? `<span class="ap-num">${label}</span>`
    : `<a class="ap-num" ${MarkupUtil.attribute('href', `#${TemplateIdUtil.ticketFragmentIdOf(ticket)}`)}>${label}</a>`;
}

/** The full name, then on lines of their own what the row no longer shows: the type, the tickets it waits on and its tokens. */
function nameTitleOf(task: ChartRowSource, waitingOn: readonly string[]): string {
  return [
    task.name,
    ...task.ticketType === undefined ? [] : [task.ticketType],
    ...waitingOn.length === 0 ? [] : [`Waiting on ${waitingOn.map((ticket) => `#${ticket}`).join(', ')}`],
    ...task.tokens === undefined || task.tokens === null ? [] : [`${TokenCountUtil.formatTokenCount(task.tokens)} tokens`],
  ].join('\n');
}

const WAITING_CHIP_LABEL  = 'Waiting';
const REVIEWED_CHIP_SUFFIX = ' ✓';

function stateChipMarkup(task: ChartRowSource, waitingOn: readonly string[], slices: TimestampSlices): string {
  const state            = task.displayState;
  const fullLabel        = WorkItemMarkupUtil.stateLabelOf(state, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
  const countsAsReviewed = task.deliveredRowCountsAsReviewed === true;
  const label            = state === 'pending' && waitingOn.length > 0 ? WAITING_CHIP_LABEL : `${fullLabel}${countsAsReviewed ? REVIEWED_CHIP_SUFFIX : ''}`;
  const title            = countsAsReviewed ? `${fullLabel} · ${WorkItemMarkupUtil.reviewedTitleOf(task, slices)}` : fullLabel;
  return `<span class="ap-state-chip" ${MarkupUtil.attribute('title', title)}><span class="ap-state-dot" aria-hidden="true"></span>`
    + `<span class="ap-state-word">${HtmlEscapeUtil.escapeHtml(label)}</span></span>`;
}

function taskRowMarkup(placed: PlacedTaskRow, drawing: TaskRowsDrawing): string {
  const {
    row,
    nestedWithTicket,
    reviewPassRound,
    reviewSegments,
  } = placed;
  const { task, bar } = row;
  const state         = task.displayState;
  const nesting    = nestedWithTicket === null ? '' : ` ${MarkupUtil.attribute('data-review-of', nestedWithTicket)}`;
  const identities = task.id === undefined
    ? ''
    : ` ${MarkupUtil.attribute('id', TemplateIdUtil.taskRowElementIdOf(task.id))} ${MarkupUtil.attribute('data-task-id', String(task.id))}`;
  const numberCell   = task.id === undefined ? '' : numberCellMarkup(task);
  const drawnBars    = [bar, ...reviewSegments.map(({ review }) => review.bar)].filter((drawnBar) => drawnBar.visible);
  const clippedLeft  = drawnBars.some((drawnBar) => drawnBar.clippedLeft);
  const clippedRight = drawnBars.some((drawnBar) => drawnBar.clippedRight);
  return [
    `<div class="ap-grid-row ap-row" tabindex="0"${identities} ${MarkupUtil.attribute('data-state', state)}${nesting}>`,
    `<div class="ap-cell-name">${numberCell}`,
    `<span class="ap-name" ${MarkupUtil.attribute('title', nameTitleOf(task, row.waitingOn))}>${HtmlEscapeUtil.escapeHtml(WorkItemMarkupUtil.displayedRowNameOf(task))}</span>`,
    `${row.trailingNameMarkup ?? ''}${stateChipMarkup(task, row.waitingOn, drawing.slices)}</div>`,
    `<div class="ap-cell-track"><span class="ap-clip-l"${clippedLeft ? '' : ' hidden'}></span>`,
    ownBarMarkup(task, bar, reviewPassRound),
    `${reviewSegmentsMarkup(reviewSegments, drawing)}<span class="ap-clip-r"${clippedRight ? '' : ' hidden'}></span></div>`,
    '</div>',
  ].join('');
}

/** The group's span on the axis, nothing when it never started or lies wholly outside the range. */
function groupSpanMarkup(group: ChartGroupModel, grouping: RowGrouping<ChartRowSource>, drawing: TaskRowsDrawing): string {
  const { span } = group;
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
  const title        = `${span.label} · ${TimeUtil.shortStampText(span.start, drawing.todayCalendarDate, drawing.slices)} → ${endText}`;
  const openMark     = group.isOpen ? ' data-open' : '';
  return `<div class="ap-epic-span"${openMark} ${placementStyle({ leftPercent, widthPercent })} ${MarkupUtil.attribute('title', title)}></div>`;
}

function headRowOpeningMarkup(groupKey: string, folded: boolean, extraAttributes: string): string {
  return `<div class="ap-grid-row ap-row ap-epic-head-row" tabindex="0" ${MarkupUtil.attribute('data-epic-key', groupKey)}${extraAttributes}`
    + ` aria-expanded="${String(!folded)}"${folded ? ' data-collapsed' : ''}>`
    + `<div class="ap-cell-name"><span class="ap-epic-caret" aria-hidden="true">${FOLD_CARET}</span>`;
}

function groupHeadRowMarkup(group: ChartGroupModel, grouping: RowGrouping<ChartRowSource>, drawing: TaskRowsDrawing): string {
  const { sharedMemberCount } = group;
  const sharedNote  = sharedMemberCount === 0
    ? ''
    : ` <span class="ap-epic-head-count" ${MarkupUtil.attribute('title', `${sharedMemberCount} of its tickets show under another epic`)}>+${sharedMemberCount} shared</span>`;
  return [
    headRowOpeningMarkup(group.key, grouping.foldedGroupKeys.has(group.key), ` ${MarkupUtil.attribute('data-epic-slot', String(group.slot))}`),
    `${group.chipMarkup}${sharedNote}<span class="ap-epic-head-done">${HtmlEscapeUtil.escapeHtml(group.doneText)}</span></div>`,
    `<div class="ap-cell-track">${groupSpanMarkup(group, grouping, drawing)}</div>`,
    '</div>',
  ].join('');
}

function ungroupedHeadRowMarkup(head: UngroupedHead, memberCount: number, grouping: RowGrouping<ChartRowSource>): string {
  return `${headRowOpeningMarkup(head.key, grouping.foldedGroupKeys.has(head.key), '')}${HtmlEscapeUtil.escapeHtml(head.label)}`
    + ` <span class="ap-epic-head-count">${memberCount}</span></div><div class="ap-cell-track"></div></div>`;
}

/** Each group's head before its rows, in the grouping's order, then the ungrouped rows under their head; a group with no rows is left out. */
function groupedTaskRowsMarkup(placedRows: readonly PlacedTaskRow[], grouping: RowGrouping<ChartRowSource>, drawing: TaskRowsDrawing): string {
  const membersByGroup = new Map<string | null, PlacedTaskRow[]>();
  for (const placed of placedRows) {
    const groupKey = grouping.groupKeyOfRow(placed.row.task);
    membersByGroup.set(groupKey, [...membersByGroup.get(groupKey) ?? [], placed]);
  }
  const { ungroupedHead } = grouping;
  const heads: Array<{ foldKey: string; memberKey: string | null; headMarkup: (memberCount: number) => string }> = [
    ...grouping.groups.map((group) => ({ foldKey: group.key, memberKey: group.key, headMarkup: () => groupHeadRowMarkup(group, grouping, drawing) })),
    ...ungroupedHead === null
      ? []
      : [{ foldKey: ungroupedHead.key, memberKey: null, headMarkup: (memberCount: number) => ungroupedHeadRowMarkup(ungroupedHead, memberCount, grouping) }],
  ];
  return heads.flatMap(({ foldKey, memberKey, headMarkup }) => {
    const members = membersByGroup.get(memberKey) ?? [];
    if (members.length === 0) {
      return [];
    }
    const shownRows = grouping.foldedGroupKeys.has(foldKey) ? [] : members.map((placed) => taskRowMarkup(placed, drawing));
    return [headMarkup(members.length), ...shownRows];
  }).join('');
}

function rowGroupingOfDrawing(drawing: TaskRowsDrawing): RowGrouping<ChartRowSource> | null {
  if (drawing.rowGrouping !== undefined && drawing.rowGrouping !== null) {
    return drawing.rowGrouping;
  }
  const epicGrouping = drawing.epicGrouping ?? null;
  if (epicGrouping === null) {
    return null;
  }
  const { epics, epicsOfTicket, ...layout } = epicGrouping;
  return { ...rowGroupingOfEpics(epics, epicsOfTicket), ...layout };
}

/** Rows arrive in filing order and are drawn in `taskRowsInDisplayOrder`, under their groups' head rows when the drawing groups them. */
export function taskRowsMarkup(rows: readonly TaskRow[], drawing: TaskRowsDrawing): string {
  const placedRows = taskRowsInDisplayOrder(rows, drawing.reviewRowsAreShown);
  const grouping   = rowGroupingOfDrawing(drawing);
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

/** The range button's label: its mode, "Fit", or the held preset ("4h") or "Custom" in the held colour, then the range's two clock times. */
export function rangeSummaryMarkup(modeLabel: string, modeIsHeld: boolean, fromEpochMilliseconds: number, toEpochMilliseconds: number): string {
  const mode = `<span class="ap-range-mode"${modeIsHeld ? ' data-held' : ''} ${MarkupUtil.attribute('title', modeIsHeld ? HELD_RANGE_TITLE : FITTED_RANGE_TITLE)}>`
    + `${HtmlEscapeUtil.escapeHtml(modeLabel)}</span>`;
  const ends = `${TimeUtil.clockOf(new Date(fromEpochMilliseconds))} → ${TimeUtil.clockOf(new Date(toEpochMilliseconds))}`;
  return `${mode}<span class="ap-range-ends">${ends}</span>`;
}

/** Names hidden tickets and epics, never task rows. */
export function hiddenWorkNoteText(hiddenTicketCount: number, hiddenEpicCount: number): string {
  const parts: string[] = [];
  if (hiddenTicketCount > 0) {
    parts.push(`${hiddenTicketCount} ticket${hiddenTicketCount === 1 ? '' : 's'}`);
  }
  if (hiddenEpicCount > 0) {
    parts.push(`${hiddenEpicCount} epic${hiddenEpicCount === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? '' : `${parts.join(' · ')} hidden`;
}
