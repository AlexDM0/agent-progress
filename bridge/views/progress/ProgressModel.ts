/**
 * The Progress chart as a model, from the Overseer's `BoardState` and the viewer's range and review-rows choice, as `page/progress/` draws
 * it. Which rows are review bars, and of which ticket's own row, are the Board's facts (`boardFacts.rows`); a ticket's review bars are
 * ordered by the round their name gives, never by a rule copied here. The geometry is `GeometryUtil`'s, moved unchanged.
 */
import { TokenCountUtil }                                from '../../../src/lib/token-count/TokenCountUtil.ts';
import type { DisplayState }                             from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }                               from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { ViewRange }                                from '../../../src/lib/tracker-model/@types/TrackerProgress.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                     from '../../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { ProgressBoardState, ProgressTaskDocument } from '../../@types/ProgressBoardState.ts';
import type { TimelineBar, TimelineTick }                from '../../@types/Timeline.ts';
import { BarPhaseUtil }                                  from '../../utils/BarPhaseUtil.ts';
import { DisplayStateWordingUtil }                       from '../../utils/DisplayStateWordingUtil.ts';
import { GeometryUtil }                                  from '../../utils/GeometryUtil.ts';
import { TimeUtil }                                      from '../../utils/TimeUtil.ts';
import { FIT_RANGE_PRESET, RANGE_PRESET_BOUNDS }         from './constants/ProgressChart.ts';
import { FitRangeUtil }                                  from './utils/FitRangeUtil.ts';

/** The static page's choice name and values, so a viewer's review-rows choice keeps its key. */
export const REVIEW_ROWS_CHOICE_NAME    = 'review-rows';
export const REVIEW_ROWS_SHOWN_CHOICE   = 'rows';
export const DEFAULT_REVIEW_ROWS_CHOICE = 'segments';

export const RANGE_PRESET_KEYS = Object.keys(RANGE_PRESET_BOUNDS);

export interface ProgressChartChoices {
  readonly presetKey:            string;
  readonly reviewRowsAreShown:   boolean;
  readonly nowEpochMilliseconds: number;
  readonly todayCalendarDate:    string;
}

/** One coloured stretch on a row's track. */
export interface ProgressBarModel {
  readonly key:          string;
  readonly leftPercent:  number;
  readonly widthPercent: number;
  readonly stateToken:   DisplayState;
  readonly isLive:       boolean;
  /** A bar the range leaves out keeps its place in the track, hidden. */
  readonly isHidden:     boolean;
  /** A review pass drawn on its ticket's row names its round and span. */
  readonly title:        string | null;
  readonly isReviewPass: boolean;
}

export interface ProgressRowModel {
  readonly taskId:           number;
  /** The ticket a row's own label links to; a review bar and a ticketless row link nowhere. */
  readonly linkedTicketId:   string | null;
  readonly labelText:        string;
  readonly nameText:         string;
  readonly nameTitle:        string;
  readonly stateToken:       DisplayState;
  readonly isLive:           boolean;
  readonly chipText:         string;
  readonly chipTitle:        string;
  /** The ticket whose row this review row is drawn directly above, or null at the top level. */
  readonly nestedWithTicket: string | null;
  readonly bars:             readonly ProgressBarModel[];
  readonly clippedLeft:      boolean;
  readonly clippedRight:     boolean;
}

export interface ProgressChartModel {
  readonly ticks:          readonly TimelineTick[];
  readonly nowPercent:     number | null;
  readonly rows:           readonly ProgressRowModel[];
  readonly rangeNoteText:  string;
  /** The note's ends in full, or null when nothing was shortened. */
  readonly rangeNoteTitle: string | null;
}

interface ChartRow {
  readonly position:                       number;
  readonly task:                           ProgressTaskDocument;
  readonly displayState:                   DisplayState;
  readonly deliveredRowCountsAsReviewed:   boolean;
  readonly ownRowPositionOfReviewedTicket: number | null;
  readonly ticketType:                     TicketType | null;
  readonly waitingOn:                      readonly string[];
  readonly bar:                            TimelineBar;
}

interface PlacedRow {
  readonly row:              ChartRow;
  readonly nestedWithTicket: string | null;
  readonly reviewPassRound:  number | null;
  readonly reviewSegments:   readonly NumberedReview[];
}

interface NumberedReview {
  readonly review: ChartRow;
  readonly round:  number;
}

/** Only the prefix is read, as when the bar was filed: `Review 2 #13, #5 — …` is round 2. */
const REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #\d+/;
const LEADING_TICKET_NUMBER_PATTERN = /^#(\d+)\s+/;
const TICKETLESS_ROW_LABEL = 'TASK';
const WAITING_CHIP_LABEL = 'Waiting';
const REVIEWED_CHIP_SUFFIX = ' ✓';

/** A name that gives no round sorts above every numbered round. */
function reviewRoundNamedBy(task: ProgressTaskDocument): number {
  const round = Number(REVIEW_BAR_NAME_PATTERN.exec(task.name)?.[1]);
  return Number.isSafeInteger(round) ? round : Number.MAX_SAFE_INTEGER;
}

/** Fit spans the rows from their earliest start to now, unless the `range` command set the tracker's own range. */
function viewRangeOf(state: ProgressBoardState, presetKey: string, nowEpochMilliseconds: number): ViewRange {
  const bounds = Object.hasOwn(RANGE_PRESET_BOUNDS, presetKey) ? RANGE_PRESET_BOUNDS[presetKey] : undefined;
  if (presetKey !== FIT_RANGE_PRESET && bounds !== undefined && bounds.fromText !== null && bounds.toText !== null) {
    return {
      kind: 'relative', from: bounds.fromText, to: bounds.toText, tickMinutes: null
    };
  }
  const { progress } = state.page.payload;
  if (progress.view.kind !== 'auto') return progress.view;
  const fitted = FitRangeUtil.fittedSpanOf(progress.tasks, nowEpochMilliseconds);
  return {
    kind:        'absolute',
    from:        new Date(fitted.fromEpochMilliseconds).toISOString(),
    to:          new Date(fitted.toEpochMilliseconds).toISOString(),
    tickMinutes: null,
  };
}

function chartRowsOf(state: ProgressBoardState, bars: readonly TimelineBar[]): ChartRow[] {
  const { payload, tickets } = state.page;
  const ticketTypeById = new Map(tickets.map((ticket) => [ticket.id, ticket.type]));
  const typeOfOwnRow = new Map(payload.boardFacts.tickets.flatMap((facts) => {
    const type = ticketTypeById.get(facts.ticketId);
    return facts.ownRowPosition === null || type === undefined ? [] : [[facts.ownRowPosition, type] as const];
  }));
  const waitingOnOfTicket = new Map(payload.boardFacts.tickets.map((facts) => [facts.ticketId, facts.waitingOnTicketIds]));
  return payload.progress.tasks.flatMap((task, position): ChartRow[] => {
    const bar = bars[position];
    if (bar === undefined) return [];
    const facts = payload.boardFacts.rows[position];
    return [{
      position,
      task,
      displayState:                   facts?.displayState ?? task.status,
      deliveredRowCountsAsReviewed:   facts?.deliveredRowCountsAsReviewed ?? false,
      ownRowPositionOfReviewedTicket: facts?.ownRowPositionOfReviewedTicket ?? null,
      ticketType:                     typeOfOwnRow.get(position) ?? null,
      waitingOn:                      task.ticket === null ? [] : waitingOnOfTicket.get(task.ticket) ?? [],
      bar,
    }];
  });
}

/** A review whose ticket's row is not drawn takes the round it was filed as. */
function roundOfUnnestedRow(row: ChartRow): number | null {
  return row.task.reviewOf === undefined && row.ownRowPositionOfReviewedTicket === null ? null : row.task.reviewBarRound ?? 1;
}

/**
 * Newest filed first, except that a review bar whose ticket's own row is drawn is a segment on that row; with review rows shown it is drawn
 * directly above that row instead, the latest round its name gives first, a name without a round above the rest, then newest filed first.
 */
function rowsInDisplayOrder(rows: readonly ChartRow[], reviewRowsAreShown: boolean): PlacedRow[] {
  const rowByPosition = new Map(rows.map((row) => [row.position, row]));
  const reviewsByParent = new Map<ChartRow, ChartRow[]>();
  for (const row of rows) {
    const parent = row.ownRowPositionOfReviewedTicket === null ? undefined : rowByPosition.get(row.ownRowPositionOfReviewedTicket);
    if (parent !== undefined && parent !== row) reviewsByParent.set(parent, [...reviewsByParent.get(parent) ?? [], row]);
  }
  const nestedRows = new Set([...reviewsByParent.values()].flat());
  return rows.toReversed().flatMap((row): PlacedRow[] => {
    if (nestedRows.has(row)) return [];
    const reviews = reviewsByParent.get(row) ?? [];
    const numberedReviews = reviews.filter((review) => review.task.start !== null).map((review, index) => ({ review, round: index + 1 }));
    const ownRow = { row, nestedWithTicket: null, reviewPassRound: roundOfUnnestedRow(row) };
    if (!reviewRowsAreShown) return [{ ...ownRow, reviewSegments: numberedReviews }];
    const roundByReview = new Map(numberedReviews.map(({ review, round }) => [review, round]));
    const latestRoundFirst = reviews.toSorted((a, b) => reviewRoundNamedBy(b.task) - reviewRoundNamedBy(a.task) || b.task.id - a.task.id);
    return [
      ...latestRoundFirst.map((review) => ({
        row: review, nestedWithTicket: row.task.ticket, reviewPassRound: roundByReview.get(review) ?? 1, reviewSegments: []
      })),
      { ...ownRow, reviewSegments: [] },
    ];
  });
}

function ownBarsOf(row: ChartRow, reviewPassRound: number | null): ProgressBarModel[] {
  const { bar, task } = row;
  const placement = { leftPercent: bar.leftPercent, widthPercent: bar.widthPercent };
  if (bar.visible && reviewPassRound !== null) {
    return [{
      key: 'own', ...placement, stateToken: BarPhaseUtil.reviewPassStateOf(reviewPassRound), isLive: task.end === null, isHidden: false, title: null, isReviewPass: false
    }];
  }
  if (bar.phases.length === 0) {
    return [{
      key: 'own', ...placement, stateToken: row.displayState, isLive: false, isHidden: !bar.visible, title: null, isReviewPass: false
    }];
  }
  return bar.phases.map((phase, index) => ({
    key:          `phase-${index}`,
    leftPercent:  phase.leftPercent,
    widthPercent: phase.widthPercent,
    stateToken:   BarPhaseUtil.segmentStateOf(phase.status, null),
    isLive:       phase.isLive,
    isHidden:     false,
    title:        null,
    isReviewPass: false,
  }));
}

function reviewSegmentBarsOf(reviews: readonly NumberedReview[], state: ProgressBoardState, todayCalendarDate: string): ProgressBarModel[] {
  const { limits } = state.page.payload;
  return reviews.flatMap(({ review, round }): ProgressBarModel[] => {
    const { task, bar } = review;
    if (!bar.visible || task.start === null) return [];
    const endText = task.end === null ? 'now' : TimeUtil.shortStampText(task.end, todayCalendarDate, limits);
    return [{
      key:          `review-${task.id}`,
      leftPercent:  bar.leftPercent,
      widthPercent: bar.widthPercent,
      stateToken:   BarPhaseUtil.reviewPassStateOf(round),
      isLive:       task.end === null,
      isHidden:     false,
      title:        `Review ${round} · ${TimeUtil.shortStampText(task.start, todayCalendarDate, limits)} → ${endText}`,
      isReviewPass: true,
    }];
  });
}

/** A name opening with its own ticket's `#NNN` drops it, since the label beside it already names the ticket. */
function displayedNameOf(task: ProgressTaskDocument): string {
  const leadingNumber = LEADING_TICKET_NUMBER_PATTERN.exec(task.name);
  if (task.ticket === null || leadingNumber === null || Number(leadingNumber[1]) !== Number(task.ticket)) return task.name;
  return task.name.slice(leadingNumber[0].length);
}

/** The full name, then on lines of their own what the row no longer shows: the type, the tickets it waits on and its tokens. */
function nameTitleOf(row: ChartRow): string {
  return [
    row.task.name,
    ...row.ticketType === null ? [] : [row.ticketType],
    ...row.waitingOn.length === 0 ? [] : [`Waiting on ${row.waitingOn.map((ticketId) => `#${ticketId}`).join(', ')}`],
    ...row.task.tokens === null ? [] : [`${TokenCountUtil.formatTokenCount(row.task.tokens)} tokens`],
  ].join('\n');
}

function rowModelOf(placed: PlacedRow, state: ProgressBoardState, todayCalendarDate: string): ProgressRowModel {
  const {
    row, nestedWithTicket, reviewPassRound, reviewSegments
  } = placed;
  const { task } = row;
  const { limits } = state.page.payload;
  const fullLabel = DisplayStateWordingUtil.stateLabelOf(row.displayState, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
  const reviewedTitle = task.reviewed === undefined ? 'Reviewed before it was done' : `Reviewed ${TimeUtil.fullStampText(task.reviewed, limits)} before it was done`;
  const drawnBars = [row.bar, ...reviewSegments.map(({ review }) => review.bar)].filter((bar) => bar.visible);
  const labelTicket = task.ticket ?? task.reviewOf ?? null;
  return {
    taskId:         task.id,
    linkedTicketId: task.ticket,
    labelText:      labelTicket === null ? TICKETLESS_ROW_LABEL : `#${labelTicket}`,
    nameText:       displayedNameOf(task),
    nameTitle:      nameTitleOf(row),
    stateToken:     row.displayState,
    isLive:         row.displayState === 'in-progress' || row.displayState === 'reviewing' || row.displayState === 're-review',
    chipText:       row.displayState === 'pending' && row.waitingOn.length > 0
      ? WAITING_CHIP_LABEL
      : `${fullLabel}${row.deliveredRowCountsAsReviewed ? REVIEWED_CHIP_SUFFIX : ''}`,
    chipTitle:    row.deliveredRowCountsAsReviewed ? `${fullLabel} · ${reviewedTitle}` : fullLabel,
    nestedWithTicket,
    bars:         [...ownBarsOf(row, reviewPassRound), ...reviewSegmentBarsOf(reviewSegments, state, todayCalendarDate)],
    clippedLeft:  drawnBars.some((bar) => bar.clippedLeft),
    clippedRight: drawnBars.some((bar) => bar.clippedRight),
  };
}

function tickStepLabel(stepMinutes: number, hourMinutes: number, dayMinutes: number): string {
  if (dayMinutes > 0 && stepMinutes % dayMinutes === 0) return `${stepMinutes / dayMinutes}d`;
  if (hourMinutes > 0 && stepMinutes % hourMinutes === 0) return `${stepMinutes / hourMinutes}h`;
  return `${stepMinutes}m`;
}

function progressChartOf(state: ProgressBoardState, choices: ProgressChartChoices): ProgressChartModel {
  const { progress, limits } = state.page.payload;
  const timeline = GeometryUtil.computeTimeline({
    progress:             { startedAt: progress.startedAt, tasks: progress.tasks },
    range:                viewRangeOf(state, choices.presetKey, choices.nowEpochMilliseconds),
    nowEpochMilliseconds: choices.nowEpochMilliseconds,
    limits,
  });
  const rows = rowsInDisplayOrder(chartRowsOf(state, timeline.bars), choices.reviewRowsAreShown);
  const step = `${tickStepLabel(timeline.stepMinutes, limits.hourMinutes, limits.dayMinutes)} ticks`;
  const { todayCalendarDate } = choices;
  const { fromEpochMilliseconds, toEpochMilliseconds } = timeline;
  const shortEnds = `${TimeUtil.shortInstantText(fromEpochMilliseconds, todayCalendarDate)} → ${TimeUtil.shortInstantText(toEpochMilliseconds, todayCalendarDate)}`;
  const fullEnds = `${TimeUtil.fullInstantText(fromEpochMilliseconds)} → ${TimeUtil.fullInstantText(toEpochMilliseconds)}`;
  const rangeNoteText = `${shortEnds} · ${step}`;
  const rangeNoteTitle = `${fullEnds} · ${step}`;
  return {
    ticks:          timeline.ticks,
    nowPercent:     timeline.nowPercent,
    rows:           rows.map((placed) => rowModelOf(placed, state, choices.todayCalendarDate)),
    rangeNoteText,
    rangeNoteTitle: rangeNoteTitle === rangeNoteText ? null : rangeNoteTitle,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The state document as the Progress chart reads it, or `null` while it lacks the page payload. */
function progressBoardStateOf(document: unknown): ProgressBoardState | null {
  if (!isRecord(document) || !isRecord(document['page'])) return null;
  const { page } = document;
  if (!Array.isArray(page['tickets']) || !isRecord(page['payload'])) return null;
  const { payload } = page;
  if (!isRecord(payload['boardFacts']) || !isRecord(payload['progress']) || !isRecord(payload['limits']) || !isRecord(payload['concurrency'])) return null;
  const { boardFacts, progress } = payload;
  if (!Array.isArray(boardFacts['rows']) || !Array.isArray(boardFacts['readyTickets']) || !Array.isArray(progress['tasks'])) return null;
  return document as unknown as ProgressBoardState;
}

export const ProgressModel = Object.freeze({ progressChartOf, progressBoardStateOf });
