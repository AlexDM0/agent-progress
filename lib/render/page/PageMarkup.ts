/**
 * Every string of HTML the page emits, as pure functions shaped by the placeholder content of `lib/render/page/template.html`. Everything from
 * the tracker or a ticket passes `escapeHtml` exactly once here, except a ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`.
 */

import { FIRST_REPEAT_REVIEW_ROUND } from '../../constants/Limits.ts';
import { ticketPriorityOf }          from '../../constants/Statuses.ts';
import type {
  LogEntry,
  Task,
  TaskStatus,
  TicketStatus,
} from '../../constants/Types.ts';
import { HtmlEscapeUtil }                 from '../../utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }                 from '../../utils/TokenCountUtil.ts';
import type { TimelineBar, TimelineTick } from './GanttGeometry.ts';
import type { PageTicket }                from './PageData.ts';

const { escapeHtml }       = HtmlEscapeUtil;
const { formatTokenCount } = TokenCountUtil;

const MILLISECONDS_PER_MINUTE = 60_000;
const PERCENT_DECIMAL_PLACES  = 2;
const PERCENT_OF_A_WHOLE     = 100;

const TICK_MINIMUM_PIXELS             = 60;
const TICK_PIXELS_PER_LABEL_CHARACTER = 9;

const TICK_LABEL_GUTTER_PIXELS = 5;

export type RowState = TaskStatus | 'reviewing';

/**
 * Every label names the state the row is actually in, and `done` means merged: a repeat review carries its round number, which
 * `pillLabelForRowState` appends, and the rest are the label as written.
 */
const PILL_LABEL_FOR_ROW_STATE: Record<RowState, string> = {
  'pending':   'unstarted',
  'running':   'wip',
  'paused':    'paused',
  'finished':  'awaiting review',
  'reviewing': 'reviewing',
  're-review': 'reviewing',
  'reviewed':  'awaiting merge',
  'delivered': 'done',
  'abandoned': 'abandoned',
};

const COLLAPSED_TICKET_STATUSES: readonly string[] = ['done', 'delivered', 'abandoned'];

const LOW_PRIORITY_TITLE  = 'Low priority: no row on the chart until it is started, and worked once no normal or high ticket is left undelivered';
const HIGH_PRIORITY_TITLE = 'High priority: dispatched before every normal ticket';

export interface TimestampSlices {
  dateAndClockLength:    number;
  calendarDateLength:    number;
  monthAndDaySliceStart: number;
  clockSliceStart:       number;
  clockSliceEnd:         number;
}

export interface TaskRow {
  task:         Task;
  ticketStatus: TicketStatus | null;
  bar:          TimelineBar;
  waitingOn:    readonly string[];
}

export interface PlacedTick extends TimelineTick {
  labelSitsLeftOfItsLine: boolean;
}

function percent(value: number): string {
  return `${value.toFixed(PERCENT_DECIMAL_PLACES)}%`;
}

/** One escaped attribute, exported because `lib/render/page/TaskDetail.ts` writes the same markup and a second copy would be a second contract. */
export function attribute(name: string, value: string): string {
  return `${name}="${escapeHtml(value)}"`;
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

export function rowStateFor(task: Task, ticketStatus: TicketStatus | null): RowState {
  return task.status === 'finished' && ticketStatus === 'in-review' ? 'reviewing' : task.status;
}

export function pillLabelForRowState(state: RowState, reviewRound: number): string {
  const label = PILL_LABEL_FOR_ROW_STATE[state];
  return state === 're-review' ? `${label} ${reviewRound}` : label;
}

function pillLabelFor(state: RowState, task: Task): string {
  return pillLabelForRowState(state, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
}

function reviewedTitleFor(task: Task, slices: TimestampSlices): string {
  return task.reviewed === undefined ? 'Reviewed before delivery' : `Reviewed ${task.reviewed.slice(0, slices.dateAndClockLength).replace('T', ' ')} before delivery`;
}

// Rows written before the review stamp existed carry none; a delivered ticket had to pass `done`, so its row counts as reviewed.
function deliveredAfterReview(task: Task, ticketStatus: TicketStatus | null): boolean {
  return task.status === 'delivered' && (task.reviewed !== undefined || ticketStatus === 'delivered');
}

function taskRowMarkup(row: TaskRow, slices: TimestampSlices): string {
  const { task, bar } = row;
  const state         = rowStateFor(task, row.ticketStatus);
  const ticketBadge   = task.ticket === null
    ? ''
    : `<a class="ap-ticket-badge" ${attribute('href', `#ap-ticket-${task.ticket}`)}>#${escapeHtml(task.ticket)}</a>`;
  const reviewedMark = deliveredAfterReview(task, row.ticketStatus)
    ? `<span class="ap-reviewed-mark" data-state="reviewed" ${attribute('title', reviewedTitleFor(task, slices))} role="img" aria-label="reviewed">✓</span>`
    : '';
  const tokens = task.tokens === null
    ? ''
    : `<span class="ap-tokens">${escapeHtml(formatTokenCount(task.tokens))} tokens</span>`;
  return [
    `<div class="ap-grid-row ap-row" ${attribute('id', `ap-task-${task.id}`)} ${attribute('data-task-id', String(task.id))} ${attribute('data-state', state)}>`,
    `<div class="ap-cell-name"><span class="ap-num">${escapeHtml(String(task.id))}</span>`,
    `<span class="ap-name" ${attribute('title', task.name)}>${escapeHtml(task.name)}</span>${ticketBadge}${waitingOnMarkup(row.waitingOn)}${tokens}</div>`,
    `<div class="ap-cell-pill"><span class="ap-pill">${escapeHtml(pillLabelFor(state, task))}</span>${reviewedMark}</div>`,
    `<div class="ap-cell-track"><span class="ap-clip-l"${bar.visible && bar.clippedLeft ? '' : ' hidden'}></span>`,
    `<div class="ap-bar"${bar.visible ? '' : ' hidden'} style="left:${percent(bar.leftPercent)};width:${percent(bar.widthPercent)}"></div>`,
    `<span class="ap-clip-r"${bar.visible && bar.clippedRight ? '' : ' hidden'}></span></div>`,
    '</div>',
  ].join('');
}

/** Rows arrive in filing order and are drawn newest first. */
export function taskRowsMarkup(rows: readonly TaskRow[], slices: TimestampSlices): string {
  return rows.toReversed().map((row) => taskRowMarkup(row, slices)).join('');
}

export function tickLayerMarkup(ticks: readonly PlacedTick[]): string {
  return ticks.map((tick) => {
    const labelStyle = tick.labelSitsLeftOfItsLine ? ` style="left:auto;right:${TICK_LABEL_GUTTER_PIXELS}px"` : '';
    return `<div class="ap-tick" style="left:${percent(tick.leftPercent)}"><span${labelStyle}>${escapeHtml(tick.label)}</span></div>`;
  }).join('');
}

export function overlayMarkup(ticks: readonly TimelineTick[], nowPercent: number | null): string {
  const gridLines = ticks
    .map((tick) => `<div class="ap-grid-line" style="left:${percent(tick.leftPercent)}"></div>`)
    .join('');
  const nowMarker = nowPercent === null
    ? '<div id="ap-now" hidden></div>'
    : `<div id="ap-now" style="--now-x:${percent(nowPercent)}"></div>`;
  return `${gridLines}${nowMarker}`;
}

/** The token figure is left out entirely when no task reports one, because `null` means "nobody said" and `0 tokens` would be a claim. */
export function summaryStatsMarkup(tasks: readonly Task[]): string {
  const doneCount          = tasks.filter((task) => task.status === 'delivered').length;
  const awaitingMergeCount = tasks.filter((task) => task.status === 'reviewed').length;
  const inReviewCount      = tasks.filter((task) => task.status === 'finished' || task.status === 're-review').length;
  const reportedTokens     = tasks.filter((task) => task.tokens !== null);
  const stats: Array<[figure: string, label: string]> = [
    [`${doneCount}/${tasks.length}`, 'done'],
    [String(awaitingMergeCount), 'awaiting merge'],
    [String(inReviewCount), 'in review'],
  ];
  if (reportedTokens.length > 0) {
    stats.push([formatTokenCount(reportedTokens.reduce((total, task) => total + (task.tokens ?? 0), 0)), 'tokens']);
  }
  return stats
    .map(([figure, label]) => `<span class="ap-stat"><span class="ap-stat-n">${escapeHtml(figure)}</span> ${escapeHtml(label)}</span>`)
    .join('<span class="ap-sep">&middot;</span>');
}

export function logItemsMarkup(entries: readonly LogEntry[], slices: TimestampSlices): string {
  const distinctDates = new Set(entries.map((entry) => entry.at.slice(0, slices.calendarDateLength)));
  const sliceStart    = distinctDates.size > 1 ? slices.monthAndDaySliceStart : slices.clockSliceStart;
  return entries
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((entry) => {
      const stamp = entry.at.slice(sliceStart, slices.clockSliceEnd).replace('T', ' ');
      return `<li><time>${escapeHtml(stamp)}</time><span>${escapeHtml(entry.text)}</span></li>`;
    })
    .join('');
}

function ticketLinksMarkup(identifiers: readonly string[]): string {
  return identifiers.map((identifier) => `<a ${attribute('href', `#ap-ticket-${identifier}`)}>#${escapeHtml(identifier)}</a>`).join(', ');
}

function waitingOnMarkup(identifiers: readonly string[]): string {
  return identifiers.length === 0 ? '' : `<span class="ap-waiting">waiting on ${ticketLinksMarkup(identifiers)}</span>`;
}

/** Normal is unmarked. Low borrows the row's quiet ticket badge and high the amber "waiting on" note: the template has no priority style of its own. */
function priorityMarkMarkup(ticket: PageTicket): string {
  const priority = ticketPriorityOf(ticket);
  if (priority === 'low') {
    return ` <span class="ap-ticket-badge" data-priority="low" ${attribute('title', LOW_PRIORITY_TITLE)}>low</span>`;
  }
  if (priority === 'high') {
    return `<span class="ap-waiting" data-priority="high" ${attribute('title', HIGH_PRIORITY_TITLE)}>high</span>`;
  }
  return '';
}

function taskLinkMarkup(taskId: number | null): string {
  return taskId === null ? '' : `<a ${attribute('href', `#ap-task-${taskId}`)}>#${escapeHtml(String(taskId))}</a>`;
}

export function ticketTableRowsMarkup(tickets: readonly PageTicket[], waitingOnById: ReadonlyMap<string, readonly string[]>): string {
  return tickets.map((ticket) => [
    `<tr ${attribute('data-ticket-id', ticket.id)}>`,
    `<td class="mono"><a ${attribute('href', `#ap-ticket-${ticket.id}`)}>#${escapeHtml(ticket.id)}</a></td>`,
    `<td>${escapeHtml(ticket.title)}${priorityMarkMarkup(ticket)}${waitingOnMarkup(waitingOnById.get(ticket.id) ?? [])}</td>`,
    `<td>${escapeHtml(ticket.type)}</td>`,
    `<td><span class="ap-badge ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span></td>`,
    `<td>${escapeHtml(ticket.group ?? '')}</td>`,
    `<td class="mono">${escapeHtml(ticket.branch ?? '')}</td>`,
    `<td class="mono">${taskLinkMarkup(ticket.task)}</td>`,
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

function ticketMetaMarkup(ticket: PageTicket, slices: TimestampSlices): string {
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
      const value      = entry.value ?? '';
      const shownValue = entry.isTimestamp ? value.slice(0, slices.dateAndClockLength).replace('T', ' ') : value;
      return `<div><b>${escapeHtml(entry.label)}</b><span>${escapeHtml(shownValue)}</span></div>`;
    })
    .join('');
  const taskEntry       = ticket.task === null ? '' : `<div><b>task</b><span>${taskLinkMarkup(ticket.task)}</span></div>`;
  const dependsOn       = ticket.dependsOn ?? [];
  const dependencyEntry = dependsOn.length === 0 ? '' : `<div><b>waits on</b><span>${ticketLinksMarkup(dependsOn)}</span></div>`;
  return `<div class="ap-ticket-meta">${shown}${taskEntry}${dependencyEntry}</div>`;
}

function latestMilestoneText(ticket: PageTicket, slices: TimestampSlices): string {
  const milestones: Array<[label: string, value: string | null | undefined]> = [
    ['delivered', ticket.delivered],
    ['abandoned', ticket.abandonedAt],
    ['finished', ticket.finished],
    ['started', ticket.started],
    ['filed', ticket.filed],
  ];
  for (const [label, value] of milestones) {
    if (typeof value === 'string' && value !== '') {
      return `${label} ${value.slice(slices.clockSliceStart, slices.clockSliceEnd)}`;
    }
  }
  return '';
}

function ticketCardMarkup(ticket: PageTicket, waitingOn: readonly string[], slices: TimestampSlices): string {
  const dates = latestMilestoneText(ticket, slices);
  const head  = [
    `<span class="ap-ticket-id">#${escapeHtml(ticket.id)}</span>`,
    `<h3 class="ap-ticket-title">${escapeHtml(ticket.title)}</h3>`,
    `<span class="ap-badge ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span>`,
    priorityMarkMarkup(ticket),
    waitingOnMarkup(waitingOn),
    dates === '' ? '' : `<span class="ap-ticket-dates">${escapeHtml(dates)}</span>`,
  ].join('');
  const body  = `${ticketMetaMarkup(ticket, slices)}<div class="ap-ticket-body md">${ticket.bodyHtml}</div>`;
  const inner = COLLAPSED_TICKET_STATUSES.includes(ticket.status)
    ? `<details><summary>${head}</summary>${body}</details>`
    : `<div class="ap-ticket-head">${head}</div>${body}`;
  return `<section class="ap-ticket" ${attribute('id', `ap-ticket-${ticket.id}`)}>${inner}</section>`;
}

export function ticketCardsMarkup(tickets: readonly PageTicket[], waitingOnById: ReadonlyMap<string, readonly string[]>, slices: TimestampSlices): string {
  return tickets.map((ticket) => ticketCardMarkup(ticket, waitingOnById.get(ticket.id) ?? [], slices)).join('');
}

function padToTwoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function clockLabelFor(epochMilliseconds: number): string {
  const moment = new Date(epochMilliseconds);
  return `${padToTwoDigits(moment.getHours())}:${padToTwoDigits(moment.getMinutes())}`;
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
  hourMinutes:                number;
  dayMinutes:                 number;
  hoursAxisLabelLimitMinutes: number;
}

export function rangeNoteText(fromEpochMilliseconds: number, toEpochMilliseconds: number, stepMinutes: number, limits: RangeNoteLimits): string {
  const spanMinutes = (toEpochMilliseconds - fromEpochMilliseconds) / MILLISECONDS_PER_MINUTE;
  const moment      = (epochMilliseconds: number): string => {
    const clock = clockLabelFor(epochMilliseconds);
    if (spanMinutes < limits.hoursAxisLabelLimitMinutes) {
      return clock;
    }
    const day = new Date(epochMilliseconds);
    return `${padToTwoDigits(day.getMonth() + 1)}-${padToTwoDigits(day.getDate())} ${clock}`;
  };
  const step = tickStepLabel(stepMinutes, limits.hourMinutes, limits.dayMinutes);
  return `${moment(fromEpochMilliseconds)} \u2192 ${moment(toEpochMilliseconds)} \u00b7 ${step} ticks`;
}
