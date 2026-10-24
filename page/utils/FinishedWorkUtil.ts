/**
 * The finished-work switch as pure rules: which delivered or abandoned tasks, tickets and epics a choice lets through beside the unfinished work,
 * how a choice reads, and how far back it reaches. DOM-free; the clock arrives as a parameter.
 */

import { MILLISECONDS_PER_MINUTE }                        from '../../src/lib/local-time/LocalTimeUtil.ts';
import type { EpicRollup }                                from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }                                      from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketFrontmatter, TicketStatus }           from '../../src/lib/tracker-model/@types/Ticket.ts';
import { SETTLED_TASK_STATUSES, SETTLED_TICKET_STATUSES } from '../../src/lib/tracker-model/constants/Statuses.ts';
import type { FinishedWorkChoice, FinishedWorkSpan }      from '../@types/ViewerChoices.ts';
import { TimeUtil }                                       from './TimeUtil.ts';
import type { DurationUnits }                             from './TimeUtil.ts';

export const DEFAULT_FINISHED_WORK_CHOICE: FinishedWorkChoice = '1d';

export const FINISHED_WORK_SPANS: readonly FinishedWorkSpan[] = ['1h', '1d', '6h', '12h', '3d', 'all'];

/** A stored `6h` or `12h`, which the filter menu no longer offers, still applies and the filter line names it. */
const HIDING_WINDOW_TEXT: Readonly<Record<Exclude<FinishedWorkSpan, 'all'>, string>> = {
  '1h':  '1 hour',
  '1d':  '1 day',
  '6h':  '6 hours',
  '12h': '12 hours',
  '3d':  '3 days',
};

const SINCE_CHOICE_PREFIX = 'since-';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const SPAN_LABEL: Readonly<Record<FinishedWorkSpan, string>> = {
  '1h':  'last hour',
  '1d':  'last day',
  '6h':  '6 hours',
  '12h': '12 hours',
  '3d':  '3 days',
  'all': 'all',
};

function spanMinutesOf(span: Exclude<FinishedWorkSpan, 'all'>, units: DurationUnits): number {
  const unitCount = Number(span.slice(0, -1));
  return unitCount * (span.endsWith('h') ? units.hourMinutes : units.dayMinutes);
}

/** The local midnight a `YYYY-MM-DD` day starts at, or null when the text names no real day. */
function dayStartEpochMillisecondsOf(calendarDate: string): number | null {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const dayStart           = new Date(year, month - 1, day);
  return dayStart.getFullYear() === year && dayStart.getMonth() === month - 1 && dayStart.getDate() === day ? dayStart.getTime() : null;
}

function sinceChoiceFor(calendarDate: string): FinishedWorkChoice | null {
  return dayStartEpochMillisecondsOf(calendarDate) === null ? null : `${SINCE_CHOICE_PREFIX}${calendarDate}`;
}

function sinceCalendarDateOf(choice: FinishedWorkChoice): string | null {
  return choice.startsWith(SINCE_CHOICE_PREFIX) ? choice.slice(SINCE_CHOICE_PREFIX.length) : null;
}

function spanOf(choice: FinishedWorkChoice): FinishedWorkSpan | null {
  return FINISHED_WORK_SPANS.find((span) => span === choice) ?? null;
}

/** A stored or clicked value read as a choice, or null when it is none. */
function choiceFrom(value: unknown): FinishedWorkChoice | null {
  if (typeof value !== 'string') {
    return null;
  }
  const span = spanOf(value as FinishedWorkChoice);
  if (span !== null) {
    return span;
  }
  const calendarDate = sinceCalendarDateOf(value as FinishedWorkChoice);
  return calendarDate === null ? null : sinceChoiceFor(calendarDate);
}

/** Finished work at or after this moment shows; `-Infinity` for all. */
function cutoffEpochMillisecondsOf(choice: FinishedWorkChoice, nowEpochMilliseconds: number, units: DurationUnits): number {
  const calendarDate = sinceCalendarDateOf(choice);
  if (calendarDate !== null) {
    return dayStartEpochMillisecondsOf(calendarDate) ?? Number.NEGATIVE_INFINITY;
  }
  const span = spanOf(choice);
  if (span === null || span === 'all') {
    return Number.NEGATIVE_INFINITY;
  }
  return nowEpochMilliseconds - spanMinutesOf(span, units) * MILLISECONDS_PER_MINUTE;
}

/**
 * When a delivered or abandoned row finished, or null for a row still open. A settled row without an end finished when it started; one
 * that never started, as a ticket abandoned while pending leaves its row, when it reached its last phase, else when its ticket closed.
 */
function taskFinishedEpochMillisecondsOf(task: Task, ticketFinishedEpochMilliseconds: number | null = null): number | null {
  if (!SETTLED_TASK_STATUSES.includes(task.status)) {
    return null;
  }
  return TimeUtil.epochMillisecondsOf(task.end ?? task.start ?? task.history?.at(-1)?.at) ?? ticketFinishedEpochMilliseconds;
}

/** When a delivered or abandoned ticket closed, or null for a ticket still open; `updated` stands in for a closing stamp it lacks. */
function ticketFinishedEpochMillisecondsOf(ticket: TicketFrontmatter): number | null {
  if (!SETTLED_TICKET_STATUSES.includes(ticket.status)) {
    return null;
  }
  const closingStamp = ticket.status === 'delivered' ? ticket.delivered : ticket.abandonedAt;
  return TimeUtil.epochMillisecondsOf(closingStamp ?? ticket.updated);
}

type DatedEpic = Pick<EpicRollup, 'ticketCountByStatus' | 'span' | 'ticketIds'>;

/**
 * When a finished epic, one with tickets that are all delivered or abandoned, ended, or null for an open or empty epic. Its span's end
 * dates it; one without, as an epic whose tickets were abandoned before any row started, ended when its last ticket closed.
 */
function epicFinishedEpochMillisecondsOf(epic: DatedEpic, ticketFinishedMomentById: ReadonlyMap<string, number | null>): number | null {
  const counts       = Object.entries(epic.ticketCountByStatus) as [TicketStatus, number][];
  const ticketCount  = counts.reduce((total, [, count]) => total + count, 0);
  const settledCount = counts.filter(([status]) => SETTLED_TICKET_STATUSES.includes(status)).reduce((total, [, count]) => total + count, 0);
  if (ticketCount === 0 || settledCount < ticketCount) {
    return null;
  }
  const ticketMoments = epic.ticketIds.flatMap((ticketId) => ticketFinishedMomentById.get(ticketId) ?? []);
  return TimeUtil.epochMillisecondsOf(epic.span?.end) ?? (ticketMoments.length === 0 ? null : Math.max(...ticketMoments));
}

interface BoardFinishedMoments {
  /** One per row, in row order: the Progress tab's. */
  tasks:                    (number | null)[];
  /** One per ticket, in ticket order: the Tickets tab's and the Kanban's. */
  tickets:                  (number | null)[];
  /** One per epic, in epic order: the Epics tab's. */
  epics:                    (number | null)[];
  ticketFinishedMomentById: ReadonlyMap<string, number | null>;
}

/** Every finished moment a board's views filter by, each row able to fall back on its ticket's and each epic on its tickets'. */
function boardFinishedMomentsOf(board: {
  rows:    readonly Task[];
  tickets: readonly TicketFrontmatter[];
  epics:   readonly DatedEpic[];
}): BoardFinishedMoments {
  const tickets                  = board.tickets.map((ticket) => ticketFinishedEpochMillisecondsOf(ticket));
  const ticketFinishedMomentById = new Map(board.tickets.map((ticket, index) => [ticket.id, tickets[index] ?? null]));
  return {
    tasks: board.rows.map((row) => taskFinishedEpochMillisecondsOf(row, row.ticket === null ? null : ticketFinishedMomentById.get(row.ticket) ?? null)),
    tickets,
    epics: board.epics.map((epic) => epicFinishedEpochMillisecondsOf(epic, ticketFinishedMomentById)),
    ticketFinishedMomentById,
  };
}

// Comparing with the cutoff is a stated clock exception that decides only what the page shows, never what is stored.
/** Unfinished work always shows, and so does finished work the page cannot date. */
function finishedMomentIsShown(finishedEpochMilliseconds: number | null, cutoffEpochMilliseconds: number): boolean {
  return finishedEpochMilliseconds === null || finishedEpochMilliseconds >= cutoffEpochMilliseconds;
}

/** The epics the Epics tab draws a card for: every open or empty one, and the finished ones that ended at or after the cutoff. */
function shownEpicsOf<Epic extends DatedEpic>(
  epics: readonly Epic[],
  ticketFinishedMomentById: ReadonlyMap<string, number | null>,
  cutoffEpochMilliseconds: number,
): Epic[] {
  return epics.filter((epic) => finishedMomentIsShown(epicFinishedEpochMillisecondsOf(epic, ticketFinishedMomentById), cutoffEpochMilliseconds));
}

function shownFinishedCountOf(finishedMoments: readonly (number | null)[], cutoffEpochMilliseconds: number): number {
  return finishedMoments.filter((moment) => moment !== null && moment >= cutoffEpochMilliseconds).length;
}

function hiddenCountOf(finishedMoments: readonly (number | null)[], cutoffEpochMilliseconds: number): number {
  return finishedMoments.filter((moment) => !finishedMomentIsShown(moment, cutoffEpochMilliseconds)).length;
}

/** What the switch's custom pill, or the switch's own pill, reads for a choice: "last hour", "6 hours", "since 09-24". */
function labelOf(choice: FinishedWorkChoice): string {
  const calendarDate = sinceCalendarDateOf(choice);
  if (calendarDate !== null) {
    return `since ${calendarDate.slice(calendarDate.indexOf('-') + 1)}`;
  }
  const span = spanOf(choice);
  return span === null ? '' : SPAN_LABEL[span];
}

/** How the choice ends "finished …": "in the last hour", "in the last 6 hours", "since 09-24", "ever". */
function windowPhraseOf(choice: FinishedWorkChoice): string {
  if (choice === 'all') {
    return 'ever';
  }
  if (choice === '1h') {
    return 'in the last hour';
  }
  if (choice === '1d') {
    return 'in the last day';
  }
  return sinceCalendarDateOf(choice) === null ? `in the last ${labelOf(choice)}` : labelOf(choice);
}

/** What the filter line reads for a choice: "Hiding closed > 1 day", "Hiding closed before 09-24", or "Showing all closed" when nothing is hidden. */
function filterLineTextOf(choice: FinishedWorkChoice, hiddenItemCount: number): { lead: string; window: string } {
  if (hiddenItemCount === 0 || choice === 'all') {
    return { lead: 'Showing all closed', window: '' };
  }
  const calendarDate = sinceCalendarDateOf(choice);
  if (calendarDate !== null) {
    return { lead: 'Hiding closed before ', window: calendarDate.slice(calendarDate.indexOf('-') + 1) };
  }
  const span = spanOf(choice);
  return { lead: 'Hiding closed > ', window: span === null || span === 'all' ? '' : HIDING_WINDOW_TEXT[span] };
}

export const FinishedWorkUtil = {
  choiceFrom,
  sinceChoiceFor,
  sinceCalendarDateOf,
  dayStartEpochMillisecondsOf,
  cutoffEpochMillisecondsOf,
  taskFinishedEpochMillisecondsOf,
  ticketFinishedEpochMillisecondsOf,
  epicFinishedEpochMillisecondsOf,
  boardFinishedMomentsOf,
  finishedMomentIsShown,
  shownEpicsOf,
  shownFinishedCountOf,
  hiddenCountOf,
  labelOf,
  windowPhraseOf,
  filterLineTextOf,
} as const;
