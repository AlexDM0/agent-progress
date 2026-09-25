/**
 * Every string of HTML the page emits, as pure functions shaped by the placeholder content of `lib/render/page/template.html`. Everything from
 * the tracker or a ticket passes `escapeHtml` exactly once here, except a ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`.
 */

import { FIRST_REPEAT_REVIEW_ROUND }               from '../../constants/Limits.ts';
import { SETTLED_TASK_STATUSES, ticketPriorityOf } from '../../constants/Statuses.ts';
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
import {
  fullInstantText,
  fullStampText,
  shortInstantText,
  shortStampText,
} from './StampText.ts';

const { escapeHtml }       = HtmlEscapeUtil;
const { formatTokenCount } = TokenCountUtil;

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

/** Text shortened for display, and its full form for the hover, or `null` where nothing was shortened. */
export interface ShortenedText {
  text:  string;
  title: string | null;
}

function shortenedText(text: string, fullText: string): ShortenedText {
  return { text, title: text === fullText ? null : fullText };
}

/** The element carrying a shortened text gets its full form as `title`; an element showing the full form carries none. */
export function shortenedTextMarkup(tagName: string, text: string, fullText: string, className = ''): string {
  const classAttribute = className === '' ? '' : ` ${attribute('class', className)}`;
  const titleAttribute = text === fullText ? '' : ` ${attribute('title', fullText)}`;
  return `<${tagName}${classAttribute}${titleAttribute}>${escapeHtml(text)}</${tagName}>`;
}

export function stampMarkup(tagName: string, stamp: string, todayCalendarDate: string, slices: TimestampSlices): string {
  return shortenedTextMarkup(tagName, shortStampText(stamp, todayCalendarDate, slices), fullStampText(stamp, slices));
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

export function rowStateFor(task: Pick<Task, 'status'>, ticketStatus: TicketStatus | null): RowState {
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
  return task.reviewed === undefined ? 'Reviewed before delivery' : `Reviewed ${fullStampText(task.reviewed, slices)} before delivery`;
}

// Rows written before the review stamp existed carry none; a delivered ticket had to pass `done`, so its row counts as reviewed.
export function deliveredAfterReview(task: Task, ticketStatus: TicketStatus | null): boolean {
  return task.status === 'delivered' && (task.reviewed !== undefined || ticketStatus === 'delivered');
}

export function reviewedMarkMarkup(task: Task, slices: TimestampSlices): string {
  return `<span class="ap-reviewed-mark" data-state="reviewed" ${attribute('title', reviewedTitleFor(task, slices))} role="img" aria-label="reviewed">✓</span>`;
}

/** Only the prefix is read, and a bundle's first id is its parent: `Review 1 #13, #5 — …` reviews #13. */
const REVIEW_NAME_PATTERN = /^Review (\d+) #(\d+)/;

function wholeNumberOrNull(text: string | undefined): number | null {
  const value = Number(text);
  return text === undefined || text === '' || !Number.isSafeInteger(value) ? null : value;
}

/** Compared as a number, so a name's `#3`, a stored `003` and a ticket row's `003` all name one ticket. */
export function reviewedTicketNumberOf(task: Task): number | null {
  if (task.reviewOf !== undefined) {
    return wholeNumberOrNull(task.reviewOf);
  }
  return wholeNumberOrNull(REVIEW_NAME_PATTERN.exec(task.name)?.[2]);
}

function reviewRoundNamedBy(task: Task): number {
  return wholeNumberOrNull(REVIEW_NAME_PATTERN.exec(task.name)?.[1]) ?? Number.MAX_SAFE_INTEGER;
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
    const ticketNumber = wholeNumberOrNull(row.task.ticket ?? undefined);
    if (ticketNumber !== null) ownRowByTicketNumber.set(ticketNumber, row);
  }

  const reviewsByParent = new Map<TaskRow, TaskRow[]>();
  for (const row of rows) {
    const reviewedNumber = row.task.ticket === null ? reviewedTicketNumberOf(row.task) : null;
    const parent         = reviewedNumber === null ? undefined : ownRowByTicketNumber.get(reviewedNumber);
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
  const state         = rowStateFor(task, row.ticketStatus);
  const ticketBadge   = task.ticket === null
    ? ''
    : `<a class="ap-ticket-badge" ${attribute('href', `#ap-ticket-${task.ticket}`)}>#${escapeHtml(task.ticket)}</a>`;
  const reviewedMark = deliveredAfterReview(task, row.ticketStatus) ? reviewedMarkMarkup(task, slices) : '';
  const tokens = task.tokens === null
    ? ''
    : `<span class="ap-tokens">${escapeHtml(formatTokenCount(task.tokens))} tokens</span>`;
  const nesting    = nestedWithTicket === null ? '' : ` ${attribute('data-review-of', nestedWithTicket)}`;
  const identities = `${attribute('id', `ap-task-${task.id}`)} ${attribute('data-task-id', String(task.id))}`;
  return [
    `<div class="ap-grid-row ap-row" tabindex="0" ${identities} ${attribute('data-state', state)}${nesting}>`,
    `<div class="ap-cell-name"><span class="ap-num">${escapeHtml(String(task.id))}</span>`,
    `<span class="ap-name" ${attribute('title', task.name)}>${escapeHtml(task.name)}</span>${ticketBadge}${waitingOnMarkup(row.waitingOn)}${tokens}</div>`,
    `<div class="ap-cell-pill"><span class="ap-pill">${escapeHtml(pillLabelFor(state, task))}</span>${reviewedMark}</div>`,
    `<div class="ap-cell-track"><span class="ap-clip-l"${bar.visible && bar.clippedLeft ? '' : ' hidden'}></span>`,
    `<div class="ap-bar"${bar.visible ? '' : ' hidden'} style="left:${percent(bar.leftPercent)};width:${percent(bar.widthPercent)}"></div>`,
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
export function summaryStatsMarkup(tasks: readonly Task[], concurrency: { limit: number; agentsInFlight: number }): string {
  const completedCount     = tasks.filter((task) => SETTLED_TASK_STATUSES.includes(task.status)).length;
  const awaitingMergeCount = tasks.filter((task) => task.status === 'reviewed').length;
  const inReviewCount      = tasks.filter((task) => task.status === 'finished' || task.status === 're-review').length;
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

/** `entryLimit` keeps the newest that many, `null` all; each stamp is shortened against the viewer's day on its own. */
export function logItemsMarkup(entries: readonly LogEntry[], slices: TimestampSlices, todayCalendarDate: string, entryLimit: number | null = null): string {
  // Within one second the later append is the newer line, so the cap never keeps an older one over it.
  return entries
    .map((entry, appendIndex) => ({ entry, appendIndex }))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.appendIndex - a.appendIndex)
    .slice(0, entryLimit ?? entries.length)
    .map(({ entry }) => `<li>${stampMarkup('time', entry.at, todayCalendarDate, slices)}<span>${escapeHtml(entry.text)}</span></li>`)
    .join('');
}

/** Where a ticket link leads: the ticket's card on the Tickets tab, or its card on the Kanban board, which the page script follows itself. */
export type TicketLinkTarget = 'ticket-card' | 'kanban-card';

function ticketLinkMarkup(identifier: string, target: TicketLinkTarget): string {
  const destination = target === 'kanban-card'
    ? `${attribute('href', `#ap-kanban-${identifier}`)} ${attribute('data-ticket-link', identifier)}`
    : attribute('href', `#ap-ticket-${identifier}`);
  return `<a ${destination}>#${escapeHtml(identifier)}</a>`;
}

function ticketLinksMarkup(identifiers: readonly string[], target: TicketLinkTarget = 'ticket-card'): string {
  return identifiers.map((identifier) => ticketLinkMarkup(identifier, target)).join(', ');
}

export function waitingOnMarkup(identifiers: readonly string[], target: TicketLinkTarget = 'ticket-card'): string {
  return identifiers.length === 0 ? '' : `<span class="ap-waiting">waiting on ${ticketLinksMarkup(identifiers, target)}</span>`;
}

/** Normal is unmarked. Low borrows the row's quiet ticket badge and high the amber "waiting on" note: the template has no priority style of its own. */
export function priorityMarkMarkup(ticket: PageTicket): string {
  const priority = ticketPriorityOf(ticket);
  if (priority === 'low') {
    return `<span class="ap-ticket-badge" data-priority="low" ${attribute('title', LOW_PRIORITY_TITLE)}>low</span>`;
  }
  if (priority === 'high') {
    return `<span class="ap-waiting" data-priority="high" ${attribute('title', HIGH_PRIORITY_TITLE)}>high</span>`;
  }
  return '';
}

/** The Tickets tab sets the quiet low badge one space off the title or status badge before it; the amber high mark carries its own margin. */
function ticketsTabPriorityMarkMarkup(ticket: PageTicket): string {
  const mark = priorityMarkMarkup(ticket);
  return ticketPriorityOf(ticket) === 'low' ? ` ${mark}` : mark;
}

function taskLinkMarkup(taskId: number | null): string {
  return taskId === null ? '' : `<a ${attribute('href', `#ap-task-${taskId}`)}>#${escapeHtml(String(taskId))}</a>`;
}

export function ticketTableRowsMarkup(tickets: readonly PageTicket[], waitingOnById: ReadonlyMap<string, readonly string[]>): string {
  return tickets.map((ticket) => [
    `<tr ${attribute('data-ticket-id', ticket.id)} tabindex="0">`,
    `<td class="mono"><a ${attribute('href', `#ap-ticket-${ticket.id}`)}>#${escapeHtml(ticket.id)}</a></td>`,
    `<td>${escapeHtml(ticket.title)}${ticketsTabPriorityMarkMarkup(ticket)}${waitingOnMarkup(waitingOnById.get(ticket.id) ?? [])}</td>`,
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
      const valueMarkup = entry.isTimestamp ? stampMarkup('span', value, todayCalendarDate, slices) : `<span>${escapeHtml(value)}</span>`;
      return `<div><b>${escapeHtml(entry.label)}</b>${valueMarkup}</div>`;
    })
    .join('');
  const taskEntry       = ticket.task === null ? '' : `<div><b>task</b><span>${taskLinkMarkup(ticket.task)}</span></div>`;
  const dependsOn       = ticket.dependsOn ?? [];
  const dependencyEntry = dependsOn.length === 0 ? '' : `<div><b>waits on</b><span>${ticketLinksMarkup(dependsOn)}</span></div>`;
  return `<div class="ap-ticket-meta">${shown}${taskEntry}${dependencyEntry}</div>`;
}

/** The newest of the ticket's closing, finishing, starting and filing stamps, labelled; the Kanban card sets it under its own class. */
export function latestMilestoneMarkup(ticket: PageTicket, slices: TimestampSlices, todayCalendarDate: string, className = 'ap-ticket-dates'): string {
  const milestones: Array<[label: string, value: string | null | undefined]> = [
    ['delivered', ticket.delivered],
    ['abandoned', ticket.abandonedAt],
    ['finished', ticket.finished],
    ['started', ticket.started],
    ['filed', ticket.filed],
  ];
  for (const [label, value] of milestones) {
    if (typeof value === 'string' && value !== '') {
      return shortenedTextMarkup('span', `${label} ${shortStampText(value, todayCalendarDate, slices)}`, `${label} ${fullStampText(value, slices)}`, className);
    }
  }
  return '';
}

function ticketCardMarkup(ticket: PageTicket, waitingOn: readonly string[], slices: TimestampSlices, todayCalendarDate: string): string {
  const head = [
    `<span class="ap-ticket-id">#${escapeHtml(ticket.id)}</span>`,
    `<h3 class="ap-ticket-title">${escapeHtml(ticket.title)}</h3>`,
    `<span class="ap-badge ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span>`,
    ticketsTabPriorityMarkMarkup(ticket),
    waitingOnMarkup(waitingOn),
    latestMilestoneMarkup(ticket, slices, todayCalendarDate),
  ].join('');
  const body  = `${ticketMetaMarkup(ticket, slices, todayCalendarDate)}<div class="ap-ticket-body md">${ticket.bodyHtml}</div>`;
  const inner = COLLAPSED_TICKET_STATUSES.includes(ticket.status)
    ? `<details><summary>${head}</summary>${body}</details>`
    : `<div class="ap-ticket-head">${head}</div>${body}`;
  return `<section class="ap-ticket" ${attribute('id', `ap-ticket-${ticket.id}`)}>${inner}</section>`;
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
  return shortenedText(`generated ${shortInstantText(generatedAtEpochMilliseconds, todayCalendarDate)}`, `generated ${fullInstantText(generatedAtEpochMilliseconds)}`);
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
  const shortEnds = `${shortInstantText(fromEpochMilliseconds, todayCalendarDate)} \u2192 ${shortInstantText(toEpochMilliseconds, todayCalendarDate)}`;
  const fullEnds  = `${fullInstantText(fromEpochMilliseconds)} \u2192 ${fullInstantText(toEpochMilliseconds)}`;
  return shortenedText(`${shortEnds} \u00b7 ${step}`, `${fullEnds} \u00b7 ${step}`);
}
