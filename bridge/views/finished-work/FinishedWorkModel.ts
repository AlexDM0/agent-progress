/**
 * The finished-work choice as pure rules, the static page's finished-work rules read from the Board facts: which delivered or
 * abandoned tickets and epics a choice lets through beside the unfinished work, how it reads, and the key it is stored under. The clock
 * arrives as a parameter; comparing with the cutoff is a stated clock exception that decides only what the Bridge shows.
 */
import type { EpicRollupDocument, PageTicketDocument } from '../../@types/BoardStateDocument.ts';

export type FinishedWorkSpan = '1h' | '1d' | '6h' | '12h' | '3d' | 'all';

/** A span, or `since-YYYY-MM-DD` for everything finished from that local midnight on. */
export type FinishedWorkChoice = FinishedWorkSpan | `since-${string}`;

/** The static page's key name, kept so a viewer's stored choice still reads: `<STORAGE_PREFIX>:<trackerId>:visibility`. */
export const FINISHED_WORK_CHOICE_NAME = 'visibility';

export const DEFAULT_FINISHED_WORK_CHOICE: FinishedWorkChoice = '1d';

/** The spans the menu offers; a stored `6h` or `12h` still applies and reads. */
export const OFFERED_FINISHED_WORK_SPANS: readonly FinishedWorkSpan[] = ['1h', '1d', '3d', 'all'];

const FINISHED_WORK_SPANS: readonly FinishedWorkSpan[] = ['1h', '1d', '6h', '12h', '3d', 'all'];

/** The hide-finished checkbox's old value, read as the default. */
const RETIRED_RECENT_VISIBILITY = 'recent';

const SINCE_CHOICE_PREFIX = 'since-';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MILLISECONDS_PER_HOUR = 3_600_000;

const HOURS_PER_DAY = 24;

const SETTLED_TICKET_STATUSES: readonly string[] = ['delivered', 'abandoned'];

const SPAN_LABEL: Readonly<Record<FinishedWorkSpan, string>> = {
  '1h':  'last hour',
  '1d':  'last day',
  '6h':  '6 hours',
  '12h': '12 hours',
  '3d':  '3 days',
  'all': 'all',
};

const HIDING_WINDOW_TEXT: Readonly<Record<Exclude<FinishedWorkSpan, 'all'>, string>> = {
  '1h':  '1 hour',
  '1d':  '1 day',
  '6h':  '6 hours',
  '12h': '12 hours',
  '3d':  '3 days',
};

function spanOf(choice: string): FinishedWorkSpan | null {
  return FINISHED_WORK_SPANS.find((span) => span === choice) ?? null;
}

/** The local midnight a `YYYY-MM-DD` day starts at, or null when the text names no real day. */
function dayStartEpochMillisecondsOf(calendarDate: string): number | null {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const dayStart = new Date(year, month - 1, day);
  return dayStart.getFullYear() === year && dayStart.getMonth() === month - 1 && dayStart.getDate() === day ? dayStart.getTime() : null;
}

function sinceCalendarDateOf(choice: FinishedWorkChoice): string | null {
  return choice.startsWith(SINCE_CHOICE_PREFIX) ? choice.slice(SINCE_CHOICE_PREFIX.length) : null;
}

function sinceChoiceFor(calendarDate: string): FinishedWorkChoice | null {
  return dayStartEpochMillisecondsOf(calendarDate) === null ? null : `${SINCE_CHOICE_PREFIX}${calendarDate}`;
}

/** A stored or clicked value read as a choice; anything unreadable, and the retired `recent`, reads as the default. */
function choiceFrom(value: string | null): FinishedWorkChoice {
  if (value === null || value === RETIRED_RECENT_VISIBILITY) return DEFAULT_FINISHED_WORK_CHOICE;
  const span = spanOf(value);
  if (span !== null) return span;
  const calendarDate = value.startsWith(SINCE_CHOICE_PREFIX) ? value.slice(SINCE_CHOICE_PREFIX.length) : null;
  return (calendarDate === null ? null : sinceChoiceFor(calendarDate)) ?? DEFAULT_FINISHED_WORK_CHOICE;
}

/** Finished work at or after this moment shows; `-Infinity` for all. */
function cutoffEpochMillisecondsOf(choice: FinishedWorkChoice, nowEpochMilliseconds: number): number {
  const calendarDate = sinceCalendarDateOf(choice);
  if (calendarDate !== null) return dayStartEpochMillisecondsOf(calendarDate) ?? Number.NEGATIVE_INFINITY;
  const span = spanOf(choice);
  if (span === null || span === 'all') return Number.NEGATIVE_INFINITY;
  const hours = Number(span.slice(0, -1)) * (span.endsWith('d') ? HOURS_PER_DAY : 1);
  return nowEpochMilliseconds - hours * MILLISECONDS_PER_HOUR;
}

function epochMillisecondsOf(stamp: string | null | undefined): number | null {
  if (stamp === null || stamp === undefined) return null;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? null : parsed;
}

/** When a delivered or abandoned ticket closed, or null for one still open; `updated` stands in for a closing stamp it lacks. */
function ticketFinishedEpochMillisecondsOf(ticket: PageTicketDocument): number | null {
  if (!SETTLED_TICKET_STATUSES.includes(ticket.status)) return null;
  return epochMillisecondsOf((ticket.status === 'delivered' ? ticket.delivered : ticket.abandonedAt) ?? ticket.updated);
}

/** When an epic whose tickets are all delivered or abandoned ended: its span's end, else its last ticket's close; null while open or empty. */
function epicFinishedEpochMillisecondsOf(epic: EpicRollupDocument, ticketFinishedMomentById: ReadonlyMap<string, number | null>): number | null {
  const counts = Object.entries(epic.ticketCountByStatus);
  const ticketCount = counts.reduce((total, [, count]) => total + count, 0);
  const settledCount = counts.filter(([status]) => SETTLED_TICKET_STATUSES.includes(status)).reduce((total, [, count]) => total + count, 0);
  if (ticketCount === 0 || settledCount < ticketCount) return null;
  const ticketMoments = epic.ticketIds.flatMap((ticketId) => ticketFinishedMomentById.get(ticketId) ?? []);
  return epochMillisecondsOf(epic.span?.end) ?? (ticketMoments.length === 0 ? null : Math.max(...ticketMoments));
}

/** Unfinished work always shows, and so does finished work that cannot be dated. */
function finishedMomentIsShown(finishedEpochMilliseconds: number | null, cutoffEpochMilliseconds: number): boolean {
  return finishedEpochMilliseconds === null || finishedEpochMilliseconds >= cutoffEpochMilliseconds;
}

function ticketFinishedMomentsOf(tickets: readonly PageTicketDocument[]): ReadonlyMap<string, number | null> {
  return new Map(tickets.map((ticket) => [ticket.id, ticketFinishedEpochMillisecondsOf(ticket)]));
}

/** Every open or empty epic, and the finished ones that ended at or after the cutoff. */
function shownEpicsOf(epics: readonly EpicRollupDocument[], tickets: readonly PageTicketDocument[], cutoffEpochMilliseconds: number): EpicRollupDocument[] {
  const ticketMoments = ticketFinishedMomentsOf(tickets);
  return epics.filter((epic) => finishedMomentIsShown(epicFinishedEpochMillisecondsOf(epic, ticketMoments), cutoffEpochMilliseconds));
}

/** The delivered and abandoned tickets the choice lets through, latest closed first, and how many it hides. */
function finishedTicketsOf(tickets: readonly PageTicketDocument[], cutoffEpochMilliseconds: number): { shown: PageTicketDocument[]; hiddenCount: number } {
  const finished = tickets.flatMap((ticket) => {
    const moment = ticketFinishedEpochMillisecondsOf(ticket);
    return moment === null ? [] : [{ ticket, moment }];
  });
  const shown = finished.filter(({ moment }) => moment >= cutoffEpochMilliseconds).toSorted((a, b) => b.moment - a.moment);
  return { shown: shown.map(({ ticket }) => ticket), hiddenCount: finished.length - shown.length };
}

/** What a choice reads as: "last hour", "6 hours", "since 09-24". */
function labelOf(choice: FinishedWorkChoice): string {
  const calendarDate = sinceCalendarDateOf(choice);
  if (calendarDate !== null) return `since ${calendarDate.slice(calendarDate.indexOf('-') + 1)}`;
  const span = spanOf(choice);
  return span === null ? '' : SPAN_LABEL[span];
}

/** How the choice ends "finished …": "in the last hour", "in the last 6 hours", "since 09-24", "ever". */
function windowPhraseOf(choice: FinishedWorkChoice): string {
  if (choice === 'all') return 'ever';
  if (choice === '1h') return 'in the last hour';
  if (choice === '1d') return 'in the last day';
  return sinceCalendarDateOf(choice) === null ? `in the last ${labelOf(choice)}` : labelOf(choice);
}

/** "Hiding closed > 1 day", "Hiding closed before 09-24", or "Showing all closed" when nothing is hidden. */
function filterLineTextOf(choice: FinishedWorkChoice, hiddenItemCount: number): string {
  if (hiddenItemCount === 0 || choice === 'all') return 'Showing all closed';
  const calendarDate = sinceCalendarDateOf(choice);
  if (calendarDate !== null) return `Hiding closed before ${calendarDate.slice(calendarDate.indexOf('-') + 1)}`;
  const span = spanOf(choice);
  return span === null || span === 'all' ? 'Showing all closed' : `Hiding closed > ${HIDING_WINDOW_TEXT[span]}`;
}

export const FinishedWorkModel = Object.freeze({
  choiceFrom,
  sinceChoiceFor,
  cutoffEpochMillisecondsOf,
  ticketFinishedEpochMillisecondsOf,
  shownEpicsOf,
  finishedTicketsOf,
  labelOf,
  windowPhraseOf,
  filterLineTextOf,
});
