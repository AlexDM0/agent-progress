/**
 * The finished-work switch as pure rules: which delivered or abandoned tasks and tickets a choice lets through beside the unfinished work,
 * how a choice reads, and how far back it reaches. DOM-free; the clock arrives as a parameter.
 */

import { MILLISECONDS_PER_MINUTE }                        from '../../src/lib/local-time/LocalTimeUtil.ts';
import type { Task }                                      from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketFrontmatter }                         from '../../src/lib/tracker-model/@types/Ticket.ts';
import { SETTLED_TASK_STATUSES, SETTLED_TICKET_STATUSES } from '../../src/lib/tracker-model/constants/Statuses.ts';
import type { FinishedWorkChoice, FinishedWorkSpan }      from '../@types/ViewerChoices.ts';
import { TimeUtil }                                       from './TimeUtil.ts';
import type { DurationUnits }                             from './TimeUtil.ts';

export const DEFAULT_FINISHED_WORK_CHOICE: FinishedWorkChoice = '1d';

export const FINISHED_WORK_SPANS: readonly FinishedWorkSpan[] = ['1h', '1d', '6h', '12h', '3d', 'all'];

/** The spans the custom popover offers as pills; `1h` and `1d` are the switch's own. */
export const CUSTOM_FINISHED_WORK_SPANS: readonly FinishedWorkSpan[] = ['6h', '12h', '3d', 'all'];

const SINCE_CHOICE_PREFIX = 'since-';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The reach marks share one log scale; this bends it so the first hours still read apart from each other. */
const REACH_SCALE_MINUTES = 10;

/** The scale reaches at least this far back, so a board whose oldest finished work is minutes old does not fill every mark. */
const REACH_MINIMUM_OLDEST_AGE_MINUTES = 60;

const SPAN_LABEL: Readonly<Record<FinishedWorkSpan, string>> = {
  '1h':  'last hour',
  '1d':  'last day',
  '6h':  '6 hours',
  '12h': '12 hours',
  '3d':  '3 days',
  'all': 'all',
};

function spanMinutesOf(span: Exclude<FinishedWorkSpan, 'all'>, units: DurationUnits): number {
  const minutesBySpan: Record<Exclude<FinishedWorkSpan, 'all'>, number> = {
    '1h':  units.hourMinutes,
    '1d':  units.dayMinutes,
    '6h':  6 * units.hourMinutes,
    '12h': 12 * units.hourMinutes,
    '3d':  3 * units.dayMinutes,
  };
  return minutesBySpan[span];
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

/** Everything but the switch's own two pills sits under its custom pill. */
function choiceIsCustom(choice: FinishedWorkChoice): boolean {
  return choice !== '1h' && choice !== '1d';
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

/** When a delivered or abandoned row finished, or null for a row still open. A settled row without an end finished when it started. */
function taskFinishedEpochMillisecondsOf(task: Task): number | null {
  return SETTLED_TASK_STATUSES.includes(task.status) ? TimeUtil.epochMillisecondsOf(task.end ?? task.start) : null;
}

/** When a delivered or abandoned ticket closed, or null for a ticket still open; `updated` stands in for a closing stamp it lacks. */
function ticketFinishedEpochMillisecondsOf(ticket: TicketFrontmatter): number | null {
  if (!SETTLED_TICKET_STATUSES.includes(ticket.status)) {
    return null;
  }
  const closingStamp = ticket.status === 'delivered' ? ticket.delivered : ticket.abandonedAt;
  return TimeUtil.epochMillisecondsOf(closingStamp ?? ticket.updated);
}

// Comparing with the cutoff is a stated clock exception that decides only what the page shows, never what is stored.
/** Unfinished work always shows, and so does finished work the page cannot date. */
function finishedMomentIsShown(finishedEpochMilliseconds: number | null, cutoffEpochMilliseconds: number): boolean {
  return finishedEpochMilliseconds === null || finishedEpochMilliseconds >= cutoffEpochMilliseconds;
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

/** Where a reach mark ends, as a percentage of its track: now at 0, the oldest finished work at 100, on one log scale for every mark. */
function reachPercentOf(cutoffEpochMilliseconds: number, oldestFinishedEpochMilliseconds: number | null, nowEpochMilliseconds: number): number {
  if (!Number.isFinite(cutoffEpochMilliseconds)) {
    return 100;
  }
  const ageMinutes       = Math.max(0, (nowEpochMilliseconds - cutoffEpochMilliseconds) / MILLISECONDS_PER_MINUTE);
  const oldestAgeMinutes = Math.max(
    REACH_MINIMUM_OLDEST_AGE_MINUTES,
    oldestFinishedEpochMilliseconds === null ? 0 : (nowEpochMilliseconds - oldestFinishedEpochMilliseconds) / MILLISECONDS_PER_MINUTE,
  );
  return Math.min(100, (100 * Math.log1p(ageMinutes / REACH_SCALE_MINUTES)) / Math.log1p(oldestAgeMinutes / REACH_SCALE_MINUTES));
}

export const FinishedWorkUtil = {
  choiceFrom,
  sinceChoiceFor,
  sinceCalendarDateOf,
  dayStartEpochMillisecondsOf,
  choiceIsCustom,
  cutoffEpochMillisecondsOf,
  taskFinishedEpochMillisecondsOf,
  ticketFinishedEpochMillisecondsOf,
  finishedMomentIsShown,
  shownFinishedCountOf,
  hiddenCountOf,
  labelOf,
  windowPhraseOf,
  reachPercentOf,
} as const;
