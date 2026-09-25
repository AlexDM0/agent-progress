/**
 * Every string of HTML the page emits, as pure functions shaped by the placeholder content of `resources/template.html`. Everything from
 * the tracker or a ticket passes `escapeHtml` exactly once here, except a ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`.
 */

import type { Task }                      from '../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }              from '../src/lib/tracker-model/@types/Ticket.ts';
import { SETTLED_TASK_STATUSES }          from '../src/lib/tracker-model/constants/Statuses.ts';
import { TicketDefaultsUtil }             from '../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import { HtmlEscapeUtil }                 from '../src/lib/utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }                 from '../src/lib/utils/TokenCountUtil.ts';
import type { PageTicket }                from '../src/shared/@types/PagePayload.ts';
import { LIMITS }                         from '../src/shared/constants/Limits.ts';
import { TicketNumberUtil }               from '../src/shared/utils/TicketNumberUtil.ts';
import type { RowState }                  from './constants/RowState.ts';
import { CLOSED_TICKET_STATUSES }         from './constants/TicketStatusGroups.ts';
import { PERCENT_OF_A_WHOLE }             from './constants/Units.ts';
import { BoardRulesUtil }                 from './utils/BoardRulesUtil.ts';
import type { TimelineBar, TimelineTick } from './utils/GeometryUtil.ts';
import type { ShortenedText }             from './utils/MarkupUtil.ts';
import { MarkupUtil }                     from './utils/MarkupUtil.ts';
import type { TimestampSlices }           from './utils/TimeUtil.ts';
import { TimeUtil }                       from './utils/TimeUtil.ts';
import { WorkItemMarkupUtil }             from './utils/WorkItemMarkupUtil.ts';

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

export interface PlacedTaskRow {
  row:              TaskRow;
  /** The ticket id of the row this one is nested with, drawn directly above it, or `null` for a row drawn at the top level. */
  nestedWithTicket: string | null;
}

/**
 * Newest filed first, except that a review row is drawn directly above its ticket's own row, latest round first. A review whose ticket has
 * no row among these — never started, or hidden as long done — stays where its filing puts it, and a ticket's own row is never nested.
 */
export function taskRowsInDisplayOrder(rows: readonly TaskRow[]): PlacedTaskRow[] {
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
export function summaryStatsMarkup(tasks: readonly Task[], concurrency: { limit: number; agentsInFlight: number }): string {
  const completedCount     = tasks.filter((task) => SETTLED_TASK_STATUSES.includes(task.status)).length;
  const awaitingMergeCount = tasks.filter((task) => task.status === 'reviewed').length;
  const inReviewCount      = tasks.filter((task) => task.status === 'in-review' || task.status === 're-review').length;
  const reportedTokens     = tasks.filter((task) => task.tokens !== null);
  const figureMarkup = (figure: string): string => `<span class="ap-stat-n">${escapeHtml(figure)}</span>`;
  const stats = [
    `Work completed: ${figureMarkup(`${completedCount} / ${tasks.length}`)}`,
    `${figureMarkup(String(awaitingMergeCount))} awaiting merge`,
    `${figureMarkup(String(inReviewCount))} in review`,
    `${figureMarkup(`${concurrency.agentsInFlight} of ${concurrency.limit}`)} ${concurrency.limit === 1 ? 'agent' : 'agents'} running`,
  ];
  if (reportedTokens.length > 0) {
    stats.push(`${figureMarkup(formatTokenCount(reportedTokens.reduce((total, task) => total + (task.tokens ?? 0), 0)))} tokens`);
  }
  return stats
    .map((statMarkup) => `<span class="ap-stat">${statMarkup}</span>`)
    .join('<span class="ap-sep">&middot;</span>');
}

/** The Tickets tab sets the quiet low badge one space off the title or status badge before it; the amber high mark carries its own margin. */
function ticketsTabPriorityMarkMarkup(ticket: PageTicket): string {
  const mark = WorkItemMarkupUtil.priorityMarkMarkup(ticket);
  return TicketDefaultsUtil.ticketPriorityOf(ticket) === 'low' ? ` ${mark}` : mark;
}

export function ticketTableRowsMarkup(tickets: readonly PageTicket[], waitingOnById: ReadonlyMap<string, readonly string[]>): string {
  return tickets.map((ticket) => [
    `<tr ${MarkupUtil.attribute('data-ticket-id', ticket.id)} tabindex="0">`,
    `<td class="mono"><a ${MarkupUtil.attribute('href', `#ap-ticket-${ticket.id}`)}>#${escapeHtml(ticket.id)}</a></td>`,
    `<td>${escapeHtml(ticket.title)}${ticketsTabPriorityMarkMarkup(ticket)}${WorkItemMarkupUtil.waitingOnMarkup(waitingOnById.get(ticket.id) ?? [])}</td>`,
    `<td>${escapeHtml(ticket.type)}</td>`,
    `<td>${WorkItemMarkupUtil.ticketStatusBadgeMarkup(ticket.status)}</td>`,
    `<td>${escapeHtml(ticket.group ?? '')}</td>`,
    `<td class="mono">${escapeHtml(ticket.branch ?? '')}</td>`,
    `<td class="mono">${WorkItemMarkupUtil.taskLinkMarkup(ticket.task)}</td>`,
    '</tr>',
  ].join('')).join('');
}

export function ticketCountText(tickets: readonly PageTicket[]): string {
  if (tickets.length === 0) {
    return 'no tickets';
  }
  const inProgressCount = tickets.filter((ticket) => ticket.status === 'in-progress').length;
  const total           = `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;
  return inProgressCount === 0 ? total : `${total} · ${inProgressCount} in progress`;
}

function ticketMetaMarkup(ticket: PageTicket, slices: TimestampSlices, todayCalendarDate: string): string {
  const entries: Array<{ label: string; value: string | null | undefined; isTimestamp: boolean }> = [
    { label: 'filed', value: ticket.filed, isTimestamp: true },
    { label: 'started', value: ticket.started, isTimestamp: true },
    { label: 'finished', value: ticket.finished, isTimestamp: true },
    { label: 'delivered', value: ticket.delivered, isTimestamp: true },
    { label: 'abandoned', value: ticket.abandonedAt, isTimestamp: true },
    { label: 'branch', value: ticket.branch, isTimestamp: false },
    { label: 'commit', value: ticket.commit, isTimestamp: false },
    { label: 'reason', value: ticket.reason, isTimestamp: false },
  ];
  const shown = entries
    .filter((entry) => typeof entry.value === 'string' && entry.value !== '')
    .map((entry) => {
      const value       = entry.value ?? '';
      const valueMarkup = entry.isTimestamp ? MarkupUtil.stampMarkup('span', value, todayCalendarDate, slices) : `<span>${escapeHtml(value)}</span>`;
      return `<div><b>${escapeHtml(entry.label)}</b>${valueMarkup}</div>`;
    })
    .join('');
  const taskEntry       = ticket.task === null ? '' : `<div><b>task</b><span>${WorkItemMarkupUtil.taskLinkMarkup(ticket.task)}</span></div>`;
  const dependsOn       = ticket.dependsOn ?? [];
  const dependencyEntry = dependsOn.length === 0 ? '' : `<div><b>waits on</b><span>${WorkItemMarkupUtil.ticketLinksMarkup(dependsOn)}</span></div>`;
  return `<div class="ap-ticket-meta">${shown}${taskEntry}${dependencyEntry}</div>`;
}

function ticketCardMarkup(ticket: PageTicket, waitingOn: readonly string[], slices: TimestampSlices, todayCalendarDate: string): string {
  const head = [
    `<span class="ap-ticket-id">#${escapeHtml(ticket.id)}</span>`,
    `<h3 class="ap-ticket-title">${escapeHtml(ticket.title)}</h3>`,
    WorkItemMarkupUtil.ticketStatusBadgeMarkup(ticket.status),
    ticketsTabPriorityMarkMarkup(ticket),
    WorkItemMarkupUtil.waitingOnMarkup(waitingOn),
    WorkItemMarkupUtil.latestMilestoneMarkup(ticket, slices, todayCalendarDate),
  ].join('');
  const body  = `${ticketMetaMarkup(ticket, slices, todayCalendarDate)}<div class="ap-ticket-body md">${ticket.bodyHtml}</div>`;
  const inner = CLOSED_TICKET_STATUSES.includes(ticket.status)
    ? `<details><summary>${head}</summary>${body}</details>`
    : `<div class="ap-ticket-head">${head}</div>${body}`;
  return `<section class="ap-ticket" ${MarkupUtil.attribute('id', `ap-ticket-${ticket.id}`)}>${inner}</section>`;
}

export function ticketCardsMarkup(
  tickets: readonly PageTicket[],
  waitingOnById: ReadonlyMap<string, readonly string[]>,
  slices: TimestampSlices,
  todayCalendarDate: string,
): string {
  return tickets.map((ticket) => ticketCardMarkup(ticket, waitingOnById.get(ticket.id) ?? [], slices, todayCalendarDate)).join('');
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
