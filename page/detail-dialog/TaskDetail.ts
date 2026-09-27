/**
 * The overview panel a double-click opens: one task, the ticket it belongs to and the log lines about either, as pure functions.
 * Every value passes `escapeHtml` exactly once here, except a ticket's `bodyHtml`, already escaped by `src/services/render/MarkdownRenderer.ts`.
 */

import { HtmlLabelUtil } from '../../src/adapters/utils/HtmlLabelUtil.ts';
import type {
  DisplayState,
  Task,
  TaskPhase,
  TaskStatus
} from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND } from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import { HtmlEscapeUtil }            from '../../src/lib/utils/HtmlEscapeUtil.ts';
import { TokenCountUtil }            from '../../src/lib/utils/TokenCountUtil.ts';
import type { PageTicket }           from '../../src/shared/@types/PagePayload.ts';
import type { IdentifiedLogEntry }   from '../../src/shared/@types/WordedLogEntry.ts';
import type { BoardRow }             from '../@types/PageBoard.ts';
import { LogMarkupUtil }             from '../utils/LogMarkupUtil.ts';
import { MarkupUtil }                from '../utils/MarkupUtil.ts';
import { NoteSentenceMatchUtil }     from '../utils/NoteSentenceMatchUtil.ts';
import type { TimestampSlices }      from '../utils/TimeUtil.ts';
import { TimeUtil }                  from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }        from '../utils/WorkItemMarkupUtil.ts';
import { DetailMarkupUtil }          from './utils/DetailMarkupUtil.ts';


const PHASES_WERE_NOT_RECORDED_NOTE = 'The phases of this row were not recorded, so what follows is derived from its own stamps and its ticket’s.';

const NO_PHASES_TO_SHOW_NOTE = 'The phases of this row were not recorded, and its stamps carry nothing to derive them from.';

const NO_LOG_LINES_NOTE = 'No log line names this row or its ticket.';

/** How far up the ladder a status is, so a derived phase a row never reached is left out; `abandoned` sits above everything it could follow. */
const LADDER_RANK_FOR_TASK_STATUS: Record<TaskStatus, number> = {
  'pending':     0,
  'in-progress': 1,
  'paused':      1,
  'in-review':   2,
  're-review':   2,
  'reviewed':    3,
  'delivered':   4,
  'abandoned':   5,
};

interface PhaseLine {
  state:       DisplayState;
  reviewRound: number;
  at:          string;
}

export interface TaskDetailInput {
  task:              BoardRow | null;
  ticket:            PageTicket | null;
  log:               readonly IdentifiedLogEntry[];
  slices:            TimestampSlices;
  todayCalendarDate: string;
}

interface StampFormat {
  slices:            TimestampSlices;
  todayCalendarDate: string;
}

/** A fact's value is either markup for a plain `<span>` or, for a stamp, the whole element carrying its title. */
type Fact = [label: string, valueMarkup: string] | [label: string, valueElementMarkup: string, carriesItsOwnElement: true];

function stampFact(label: string, stamp: string, format: StampFormat): Fact {
  return [label, MarkupUtil.stampMarkup('span', stamp, format.todayCalendarDate, format.slices), true];
}

function factsMarkup(entries: readonly Fact[]): string {
  const rows = entries.map(([label, valueMarkup, carriesItsOwnElement]) => {
    const valueElement = carriesItsOwnElement === true ? valueMarkup : `<span>${valueMarkup}</span>`;
    return DetailMarkupUtil.factMarkup(label, valueElement);
  }).join('');
  return `<div class="ap-ticket-meta">${rows}</div>`;
}

function durationBetween(fromTimestamp: string | null | undefined, toTimestamp: string | null | undefined): string | null {
  const fromEpochMilliseconds = TimeUtil.epochMillisecondsOf(fromTimestamp);
  const toEpochMilliseconds   = TimeUtil.epochMillisecondsOf(toTimestamp);
  return fromEpochMilliseconds === null || toEpochMilliseconds === null ? null : TimeUtil.formatDuration(toEpochMilliseconds - fromEpochMilliseconds);
}

function taskFactsMarkup(task: Task, format: StampFormat): string {
  const elapsed = durationBetween(task.start, task.end);
  const entries: Fact[] = [];

  if (task.owner !== '') entries.push(['owner', HtmlEscapeUtil.escapeHtml(task.owner)]);
  if (task.note !== '') entries.push(['note', HtmlEscapeUtil.escapeHtml(task.note)]);
  if (task.start !== null) entries.push(stampFact('start', task.start, format));
  if (task.end !== null) entries.push(stampFact('end', task.end, format));
  if (elapsed !== null) entries.push(['elapsed', HtmlEscapeUtil.escapeHtml(elapsed)]);
  if (task.tokens !== null) entries.push(['tokens', HtmlEscapeUtil.escapeHtml(TokenCountUtil.formatTokenCount(task.tokens))]);
  if (task.reviewRound !== undefined) entries.push(['review round', HtmlEscapeUtil.escapeHtml(String(task.reviewRound))]);
  if (task.ticket !== null) entries.push(['ticket', WorkItemMarkupUtil.ticketLinksMarkup([task.ticket])]);

  return factsMarkup(entries);
}

/**
 * A round is counted off the list rather than read from the row, because a row stays in `re-review` between rounds and carries only the
 * last. The count restarts at a `pending` phase, which is what `TaskTransitionUtil.transitionedTaskOf` does to `reviewRound` when a row
 * is sent back.
 */
function recordedPhaseLines(task: Task): PhaseLine[] {
  let repeatReviews = 0;
  return (task.history ?? []).map((phase) => {
    if (phase.status === 'pending') repeatReviews = 0;
    if (phase.status === 're-review') repeatReviews += 1;
    return {
      state:       phase.status,
      reviewRound: FIRST_REPEAT_REVIEW_ROUND + Math.max(0, repeatReviews - 1),
      at:          phase.at,
    };
  });
}

/** The newest phase is the row as it stands, so it takes the row's display state from the Board facts, as the chart does; an older phase keeps its own. */
function readNewestPhaseAsTheChartDoes(lines: readonly PhaseLine[], task: BoardRow): PhaseLine[] {
  const newest = lines.at(-1);
  if (newest === undefined || newest.state !== task.status) {
    return [...lines];
  }
  return [...lines.slice(0, -1), { ...newest, state: task.displayState }];
}

/**
 * Ladder order rather than stamp order: the ladder is the sequence, and nothing here compares two clocks to decide anything.
 * An abandoned row's `end` is the moment it was called off, so it stands in for the abandonment and never for a finish — only
 * the ticket's own `finished` stamp is evidence that a row abandoned out of review had ever been handed in.
 */
function derivedPhases(task: Task, ticket: PageTicket | null): TaskPhase[] {
  const reachedRank     = LADDER_RANK_FOR_TASK_STATUS[task.status];
  const rowWasAbandoned = task.status === 'abandoned';
  const candidates: Array<[status: TaskStatus, at: string | null | undefined]> = [
    ['pending', ticket?.filed],
    ['in-progress', task.start ?? ticket?.started],
    ['in-review', rowWasAbandoned ? ticket?.finished : task.end ?? ticket?.finished],
    ['reviewed', task.reviewed],
    ['delivered', ticket?.delivered],
    ['abandoned', rowWasAbandoned ? ticket?.abandonedAt ?? task.end : null],
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

function phaseListMarkup(lines: readonly PhaseLine[], format: StampFormat): string {
  const items = lines.map((line, index) => {
    const gapDuration = durationBetween(lines[index - 1]?.at, line.at);
    const gap         = gapDuration === null ? '' : `<span class="ap-detail-gap">after ${HtmlEscapeUtil.escapeHtml(gapDuration)}</span>`;
    return [
      `<li ${MarkupUtil.attribute('data-state', line.state)}>`,
      `<span class="ap-pill">${HtmlEscapeUtil.escapeHtml(WorkItemMarkupUtil.pillLabelForDisplayState(line.state, line.reviewRound))}</span>`,
      MarkupUtil.stampMarkup('time', line.at, format.todayCalendarDate, format.slices),
      gap,
      '</li>',
    ].join('');
  }).join('');
  return `<ol class="ap-detail-phases">${items}</ol>`;
}

function noteMarkup(text: string): string {
  return `<p class="ap-detail-note">${HtmlEscapeUtil.escapeHtml(text)}</p>`;
}

function phasesMarkup(task: BoardRow, ticket: PageTicket | null, format: StampFormat): string {
  const wasRecorded = (task.history ?? []).length > 0;
  const filed       = wasRecorded ? recordedPhaseLines(task) : derivedPhaseLines(task, ticket);
  const lines       = readNewestPhaseAsTheChartDoes(filed, task);
  if (lines.length === 0) {
    return noteMarkup(NO_PHASES_TO_SHOW_NOTE);
  }
  return `${wasRecorded ? '' : noteMarkup(PHASES_WERE_NOT_RECORDED_NOTE)}${phaseListMarkup(lines, format)}`;
}

function ticketFactsMarkup(ticket: PageTicket, format: StampFormat): string {
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
  const entries: Fact[] = [];

  for (const [label, value] of stamps) {
    if (value !== null && value !== '') entries.push(stampFact(label, value, format));
  }
  for (const [label, value] of plainValues) {
    if (value !== undefined && value !== '') entries.push([label, HtmlEscapeUtil.escapeHtml(value)]);
  }
  if (ticket.task !== null) entries.push(['task', WorkItemMarkupUtil.taskLinkMarkup(ticket.task)]);
  const dependsOn = ticket.dependsOn ?? [];
  if (dependsOn.length > 0) entries.push(['waits on', WorkItemMarkupUtil.ticketLinksMarkup(dependsOn)]);

  return factsMarkup(entries);
}

function ticketMarkup(ticket: PageTicket, format: StampFormat): string {
  const head = [
    '<div class="ap-detail-ticket-head">',
    `<span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`,
    `<h4 class="ap-ticket-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}</h4>`,
    `<span class="ap-detail-type">${HtmlEscapeUtil.escapeHtml(HtmlLabelUtil.ticketTypeLabelOf(ticket.type))}</span>`,
    WorkItemMarkupUtil.ticketStatusBadgeMarkup(ticket.status),
    '</div>',
  ].join('');
  return `${head}${ticketFactsMarkup(ticket, format)}<div class="ap-ticket-body md">${ticket.bodyHtml}</div>`;
}

function entryIsAboutTaskOrTicket(entry: IdentifiedLogEntry, task: Task | null, ticket: PageTicket | null): boolean {
  if (entry.taskIds === undefined || entry.ticketIds === undefined) {
    return NoteSentenceMatchUtil.noteNamesTaskOrTicket(entry.text, task?.id ?? null, ticket?.id ?? null);
  }
  return (task !== null && entry.taskIds.includes(task.id)) || (ticket !== null && entry.ticketIds.includes(ticket.id));
}

function logMarkup(input: TaskDetailInput): string {
  const { task, ticket } = input;
  const named = input.log.filter((entry) => entryIsAboutTaskOrTicket(entry, task, ticket));
  if (named.length === 0) {
    return noteMarkup(NO_LOG_LINES_NOTE);
  }
  return `<ul class="ap-detail-log">${LogMarkupUtil.logItemsMarkup(named, input.slices, input.todayCalendarDate)}</ul>`;
}

function headMarkup(task: BoardRow | null, ticket: PageTicket | null): string {
  if (task === null) {
    // A ticket whose row was removed: there is no state to colour the header with, so the ticket's own badge carries it.
    return ticket === null ? '' : [
      '<div class="ap-detail-head">',
      `<span class="ap-detail-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`,
      `<h2 class="ap-detail-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}</h2>`,
      WorkItemMarkupUtil.ticketStatusBadgeMarkup(ticket.status),
      '</div>',
    ].join('');
  }
  const state       = task.displayState;
  const ticketBadge = task.ticket === null ? '' : WorkItemMarkupUtil.ticketBadgeMarkup(task.ticket);
  return [
    `<div class="ap-detail-head" ${MarkupUtil.attribute('data-state', state)}>`,
    `<span class="ap-detail-id">#${HtmlEscapeUtil.escapeHtml(String(task.id))}</span>`,
    `<h2 class="ap-detail-title">${HtmlEscapeUtil.escapeHtml(task.name)}</h2>`,
    `<span class="ap-pill">${HtmlEscapeUtil.escapeHtml(WorkItemMarkupUtil.pillLabelForDisplayState(state, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND))}</span>`,
    ticketBadge,
    '</div>',
  ].join('');
}

/** Empty when neither a task nor a ticket was found, so a double-click on something the page cannot resolve opens nothing. */
export function taskDetailMarkup(input: TaskDetailInput): string {
  const { task, ticket } = input;
  if (task === null && ticket === null) {
    return '';
  }
  return [
    headMarkup(task, ticket),
    task === null ? '' : DetailMarkupUtil.sectionMarkup('Task', taskFactsMarkup(task, input)),
    task === null ? '' : DetailMarkupUtil.sectionMarkup('Phases', phasesMarkup(task, ticket, input)),
    ticket === null ? '' : DetailMarkupUtil.sectionMarkup('Ticket', ticketMarkup(ticket, input)),
    DetailMarkupUtil.sectionMarkup('Log', logMarkup(input)),
  ].join('');
}
