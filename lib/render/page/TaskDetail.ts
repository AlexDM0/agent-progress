/**
 * The overview panel a double-click opens: one task, the ticket it belongs to and the log lines that name either, as pure functions.
 * Every value passes `escapeHtml` exactly once here, except a ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`.
 */

import { FIRST_REPEAT_REVIEW_ROUND } from '../../constants/Limits.ts';
import type {
  LogEntry,
  Task,
  TaskPhase,
  TaskStatus,
  TicketStatus,
} from '../../constants/Types.ts';
import { HtmlEscapeUtil }                                    from '../../utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }                                    from '../../utils/TokenCountUtil.ts';
import type { PageTicket }                                   from './PageData.ts';
import type { RowState, TimestampSlices }                    from './PageMarkup.ts';
import { logItemsMarkup, pillLabelForRowState, rowStateFor } from './PageMarkup.ts';

const { escapeHtml }       = HtmlEscapeUtil;
const { formatTokenCount } = TokenCountUtil;

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR        = 60;
const HOURS_PER_DAY           = 24;

const SHORTEST_NAMED_DURATION = 'under a minute';

const PHASES_WERE_NOT_RECORDED_NOTE = 'The phases of this row were not recorded, so what follows is derived from its own stamps and its ticket’s.';

const NO_PHASES_TO_SHOW_NOTE = 'The phases of this row were not recorded, and its stamps carry nothing to derive them from.';

/** How far up the ladder a status is, so a derived phase a row never reached is left out; `abandoned` sits above everything it could follow. */
const LADDER_RANK_FOR_TASK_STATUS: Record<TaskStatus, number> = {
  'pending':   0,
  'running':   1,
  'paused':    1,
  'finished':  2,
  're-review': 2,
  'reviewed':  3,
  'delivered': 4,
  'abandoned': 5,
};

interface PhaseLine {
  state:       RowState;
  reviewRound: number;
  at:          string;
}

export interface TaskDetailInput {
  task:   Task | null;
  ticket: PageTicket | null;
  log:    readonly LogEntry[];
  slices: TimestampSlices;
}

function attribute(name: string, value: string): string {
  return `${name}="${escapeHtml(value)}"`;
}

function stampText(timestamp: string, slices: TimestampSlices): string {
  return timestamp.slice(0, slices.dateAndClockLength).replace('T', ' ');
}

/** Instants the tool wrote are sliced for display; a span between two of them has no wall clock to preserve, so it is parsed and formatted. */
function epochMillisecondsOf(timestamp: string | null | undefined): number | null {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return null;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / MILLISECONDS_PER_MINUTE);
  if (totalMinutes < 1) {
    return SHORTEST_NAMED_DURATION;
  }
  const days    = Math.floor(totalMinutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours   = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (days > 0) {
    return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function ticketLinkMarkup(ticketId: string): string {
  return `<a ${attribute('href', `#ap-ticket-${ticketId}`)}>#${escapeHtml(ticketId)}</a>`;
}

function taskLinkMarkup(taskId: number): string {
  return `<a ${attribute('href', `#ap-task-${taskId}`)}>#${escapeHtml(String(taskId))}</a>`;
}

function factsMarkup(entries: ReadonlyArray<[label: string, valueMarkup: string]>): string {
  const rows = entries.map(([label, valueMarkup]) => `<div><b>${escapeHtml(label)}</b><span>${valueMarkup}</span></div>`).join('');
  return `<div class="ap-ticket-meta">${rows}</div>`;
}

function taskFactsMarkup(task: Task, slices: TimestampSlices): string {
  const startEpochMilliseconds = epochMillisecondsOf(task.start);
  const endEpochMilliseconds   = epochMillisecondsOf(task.end);
  const entries: Array<[label: string, valueMarkup: string]> = [];

  if (task.owner !== '') entries.push(['owner', escapeHtml(task.owner)]);
  if (task.start !== null) entries.push(['start', escapeHtml(stampText(task.start, slices))]);
  if (task.end !== null) entries.push(['end', escapeHtml(stampText(task.end, slices))]);
  if (startEpochMilliseconds !== null && endEpochMilliseconds !== null) {
    entries.push(['elapsed', escapeHtml(formatDuration(endEpochMilliseconds - startEpochMilliseconds))]);
  }
  if (task.tokens !== null) entries.push(['tokens', escapeHtml(formatTokenCount(task.tokens))]);
  if (task.reviewRound !== undefined) entries.push(['review round', escapeHtml(String(task.reviewRound))]);
  if (task.ticket !== null) entries.push(['ticket', ticketLinkMarkup(task.ticket)]);

  return factsMarkup(entries);
}

/** A round is counted off the list rather than read from the row, because a row stays in `re-review` between rounds and carries only the last. */
function recordedPhaseLines(task: Task): PhaseLine[] {
  let repeatReviews = 0;
  return (task.history ?? []).map((phase) => {
    if (phase.status === 're-review') repeatReviews += 1;
    return {
      state:       phase.status,
      reviewRound: FIRST_REPEAT_REVIEW_ROUND + Math.max(0, repeatReviews - 1),
      at:          phase.at,
    };
  });
}

/**
 * The newest phase is the row as it stands, so it is read the way the chart reads it: the one state a task status cannot name on its
 * own is a `finished` row whose ticket is `in-review`. An older phase keeps the status it was filed under.
 */
function readNewestPhaseAsTheChartDoes(lines: readonly PhaseLine[], task: Task, ticketStatus: TicketStatus | null): PhaseLine[] {
  const newest = lines.at(-1);
  if (newest === undefined || newest.state !== task.status) {
    return [...lines];
  }
  return [...lines.slice(0, -1), { ...newest, state: rowStateFor(task, ticketStatus) }];
}

/** Ladder order rather than stamp order: the ladder is the sequence, and nothing here compares two clocks to decide anything. */
function derivedPhases(task: Task, ticket: PageTicket | null): TaskPhase[] {
  const reachedRank = LADDER_RANK_FOR_TASK_STATUS[task.status];
  const candidates: Array<[status: TaskStatus, at: string | null | undefined]> = [
    ['pending', ticket?.filed],
    ['running', task.start ?? ticket?.started],
    ['finished', task.end ?? ticket?.finished],
    ['reviewed', task.reviewed],
    ['delivered', ticket?.delivered],
    ['abandoned', task.status === 'abandoned' ? ticket?.abandonedAt ?? task.end : null],
  ];
  return candidates.flatMap(([status, at]) => (typeof at === 'string' && at !== '' && LADDER_RANK_FOR_TASK_STATUS[status] <= reachedRank
    ? [{ status, at }]
    : []));
}

function derivedPhaseLines(task: Task, ticket: PageTicket | null): PhaseLine[] {
  return derivedPhases(task, ticket).map((phase) => ({
    state:       phase.status,
    reviewRound: task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND,
    at:          phase.at,
  }));
}

function phaseListMarkup(lines: readonly PhaseLine[], slices: TimestampSlices): string {
  const items = lines.map((line, index) => {
    const previous              = lines[index - 1];
    const previousMilliseconds  = previous === undefined ? null : epochMillisecondsOf(previous.at);
    const thisMilliseconds      = epochMillisecondsOf(line.at);
    const gap                   = previousMilliseconds === null || thisMilliseconds === null
      ? ''
      : `<span class="ap-detail-gap">after ${escapeHtml(formatDuration(thisMilliseconds - previousMilliseconds))}</span>`;
    return [
      `<li ${attribute('data-state', line.state)}>`,
      `<span class="ap-pill">${escapeHtml(pillLabelForRowState(line.state, line.reviewRound))}</span>`,
      `<time>${escapeHtml(stampText(line.at, slices))}</time>`,
      gap,
      '</li>',
    ].join('');
  }).join('');
  return `<ol class="ap-detail-phases">${items}</ol>`;
}

function noteMarkup(text: string): string {
  return `<p class="ap-detail-note">${escapeHtml(text)}</p>`;
}

function phasesMarkup(task: Task, ticket: PageTicket | null, slices: TimestampSlices): string {
  const wasRecorded = (task.history ?? []).length > 0;
  const filed       = wasRecorded ? recordedPhaseLines(task) : derivedPhaseLines(task, ticket);
  const lines       = readNewestPhaseAsTheChartDoes(filed, task, ticket?.status ?? null);
  if (lines.length === 0) {
    return noteMarkup(NO_PHASES_TO_SHOW_NOTE);
  }
  return `${wasRecorded ? '' : noteMarkup(PHASES_WERE_NOT_RECORDED_NOTE)}${phaseListMarkup(lines, slices)}`;
}

function ticketFactsMarkup(ticket: PageTicket, slices: TimestampSlices): string {
  const stamps: Array<[label: string, value: string | null]> = [
    ['filed', ticket.filed],
    ['started', ticket.started],
    ['finished', ticket.finished],
    ['delivered', ticket.delivered],
    ['abandoned', ticket.abandonedAt],
  ];
  const plainValues: Array<[label: string, value: string | undefined]> = [
    ['group', ticket.group],
    ['branch', ticket.branch],
    ['commit', ticket.commit],
    ['reason', ticket.reason],
  ];
  const entries: Array<[label: string, valueMarkup: string]> = [];

  for (const [label, value] of stamps) {
    if (value !== null && value !== '') entries.push([label, escapeHtml(stampText(value, slices))]);
  }
  for (const [label, value] of plainValues) {
    if (value !== undefined && value !== '') entries.push([label, escapeHtml(value)]);
  }
  if (ticket.task !== null) entries.push(['task', taskLinkMarkup(ticket.task)]);
  const dependsOn = ticket.dependsOn ?? [];
  if (dependsOn.length > 0) entries.push(['waits on', dependsOn.map(ticketLinkMarkup).join(', ')]);

  return factsMarkup(entries);
}

function ticketMarkup(ticket: PageTicket, slices: TimestampSlices): string {
  const head = [
    '<div class="ap-detail-ticket-head">',
    `<span class="ap-ticket-id">#${escapeHtml(ticket.id)}</span>`,
    `<h4 class="ap-ticket-title">${escapeHtml(ticket.title)}</h4>`,
    `<span class="ap-detail-type">${escapeHtml(ticket.type)}</span>`,
    `<span class="ap-badge ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span>`,
    '</div>',
  ].join('');
  return `${head}${ticketFactsMarkup(ticket, slices)}<div class="ap-ticket-body md">${ticket.bodyHtml}</div>`;
}

/** A reference is `#7` or `#003` exactly: the lookahead is what keeps task 1 from claiming every line that mentions task 13. */
function textNamesReference(text: string, reference: string): boolean {
  return new RegExp(`${reference}(?![0-9])`).test(text);
}

function logMarkup(input: TaskDetailInput): string {
  const references: string[] = [];
  if (input.task !== null) references.push(`#${input.task.id}`);
  if (input.ticket !== null) references.push(`#${input.ticket.id}`);
  const named = input.log.filter((entry) => references.some((reference) => textNamesReference(entry.text, reference)));
  return `<ul class="ap-detail-log">${logItemsMarkup(named, input.slices)}</ul>`;
}

function headMarkup(task: Task | null, ticket: PageTicket | null): string {
  if (task === null) {
    // A ticket whose row was removed: there is no state to colour the header with, so the ticket's own badge carries it.
    return ticket === null ? '' : [
      '<div class="ap-detail-head">',
      `<span class="ap-detail-id">#${escapeHtml(ticket.id)}</span>`,
      `<h2 class="ap-detail-title">${escapeHtml(ticket.title)}</h2>`,
      `<span class="ap-badge ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span>`,
      '</div>',
    ].join('');
  }
  const state       = rowStateFor(task, ticket?.status ?? null);
  const ticketBadge = task.ticket === null ? '' : `<a class="ap-ticket-badge" ${attribute('href', `#ap-ticket-${task.ticket}`)}>#${escapeHtml(task.ticket)}</a>`;
  return [
    `<div class="ap-detail-head" ${attribute('data-state', state)}>`,
    `<span class="ap-detail-id">#${escapeHtml(String(task.id))}</span>`,
    `<h2 class="ap-detail-title">${escapeHtml(task.name)}</h2>`,
    `<span class="ap-pill">${escapeHtml(pillLabelForRowState(state, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND))}</span>`,
    ticketBadge,
    '</div>',
  ].join('');
}

function sectionMarkup(title: string, bodyMarkup: string): string {
  return `<section class="ap-detail-section"><h3 class="ap-detail-section-title">${escapeHtml(title)}</h3>${bodyMarkup}</section>`;
}

/** Empty when neither a task nor a ticket was found, so a double-click on something the page cannot resolve opens nothing. */
export function taskDetailMarkup(input: TaskDetailInput): string {
  const { task, ticket, slices } = input;
  if (task === null && ticket === null) {
    return '';
  }
  return [
    headMarkup(task, ticket),
    task === null ? '' : sectionMarkup('Task', taskFactsMarkup(task, slices)),
    task === null ? '' : sectionMarkup('Phases', phasesMarkup(task, ticket, slices)),
    ticket === null ? '' : sectionMarkup('Ticket', ticketMarkup(ticket, slices)),
    sectionMarkup('Log', logMarkup(input)),
  ].join('');
}
