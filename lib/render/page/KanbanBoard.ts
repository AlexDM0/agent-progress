/**
 * The Kanban tab's rules: which lane a ticket's card sits in, the order within a lane, what a lane head counts, the sub-state note a card
 * carries and how far the Done and Abandoned lanes are opened. DOM-free, and reads no clock: the page's now is handed in.
 */

import { FIRST_REPEAT_REVIEW_ROUND }                                 from '../../constants/Limits.ts';
import { TASK_STATUS_FOR_TICKET_STATUS, ticketPriorityOf }           from '../../constants/Statuses.ts';
import type { Task, TicketPriority }                                 from '../../constants/Types.ts';
import type { PageTicket }                                           from './PageData.ts';
import type { RowState, TimestampSlices }                            from './PageMarkup.ts';
import { deliveredAfterReview, reviewedTicketNumberOf, rowStateFor } from './PageMarkup.ts';
import { shortStampText }                                            from './StampText.ts';
import { formatDuration }                                            from './TaskDetail.ts';

export type KanbanLane = 'todo' | 'progress' | 'review' | 'merge' | 'done' | 'abandoned';

export type ClosedKanbanLane = 'done' | 'abandoned';

export const KANBAN_LANES: readonly KanbanLane[] = ['todo', 'progress', 'review', 'merge', 'done', 'abandoned'];

export const CAPPED_LANE_FIRST_PAGE = 15;
export const CAPPED_LANE_PAGE_STEP  = 25;

export const OVERFLOW_TOLERANCE_PIXELS = 1;

const ABANDONED_LANE_OPEN_CHOICE = 'open';

export const DEFAULT_ABANDONED_LANE_CHOICE = 'closed';

/** A card's lane is the pill its ticket's own row shows on the Progress tab. */
const LANE_FOR_ROW_STATE: Record<RowState, KanbanLane> = {
  'pending':   'todo',
  'running':   'progress',
  'paused':    'progress',
  'finished':  'review',
  'reviewing': 'review',
  're-review': 'review',
  'reviewed':  'merge',
  'delivered': 'done',
  'abandoned': 'abandoned',
};

const PRIORITY_ORDER: Record<TicketPriority, number> = { high: 0, normal: 1, low: 2 };

export interface KanbanCard {
  ticket:    PageTicket;
  /** The task whose `ticket` is this ticket's id, or `null` for a ticket never started. */
  ownRow:    Task | null;
  state:     RowState;
  waitingOn: readonly string[];
}

export interface NoteFormat {
  tasks:                readonly Task[];
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  slices:               TimestampSlices;
}

export function ownRowOf(ticketId: string, tasks: readonly Task[]): Task | null {
  return tasks.find((task) => task.ticket === ticketId) ?? null;
}

/** A ticket with no row reads the pill a row in its status's task status would show. */
export function cardStateFor(ticket: PageTicket, ownRow: Task | null): RowState {
  return rowStateFor(ownRow ?? { status: TASK_STATUS_FOR_TICKET_STATUS[ticket.status] }, ticket.status);
}

export function laneOfState(state: RowState): KanbanLane {
  return LANE_FOR_ROW_STATE[state];
}

export function kanbanCardsFor(tickets: readonly PageTicket[], tasks: readonly Task[], waitingOnById: ReadonlyMap<string, readonly string[]>): KanbanCard[] {
  return tickets.map((ticket) => {
    const ownRow = ownRowOf(ticket.id, tasks);
    return {
      ticket,
      ownRow,
      state:     cardStateFor(ticket, ownRow),
      waitingOn: waitingOnById.get(ticket.id) ?? [],
    };
  });
}

export function laneIsClosed(lane: KanbanLane): lane is ClosedKanbanLane {
  return lane === 'done' || lane === 'abandoned';
}

export function laneMixesStates(lane: KanbanLane): boolean {
  return lane === 'progress' || lane === 'review';
}

function closingStampOf(ticket: PageTicket, lane: ClosedKanbanLane): string | null {
  return lane === 'done' ? ticket.delivered : ticket.abandonedAt;
}

function epochMillisecondsOrOldest(stamp: string | null): number {
  const parsed = stamp === null ? Number.NaN : Date.parse(stamp);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function idNumberOf(card: KanbanCard): number {
  return Number(card.ticket.id);
}

/** Open lanes run high → normal → low, then by id as a number; the closed lanes newest first by their closing stamp, a tie to the higher id. */
export function cardsInLane(cards: readonly KanbanCard[], lane: KanbanLane): KanbanCard[] {
  const members = cards.filter((card) => laneOfState(card.state) === lane);
  if (laneIsClosed(lane)) {
    return members.toSorted((a, b) => {
      const newerFirst = epochMillisecondsOrOldest(closingStampOf(b.ticket, lane)) - epochMillisecondsOrOldest(closingStampOf(a.ticket, lane));
      return (Number.isNaN(newerFirst) ? 0 : newerFirst) || idNumberOf(b) - idNumberOf(a);
    });
  }
  return members.toSorted((a, b) => PRIORITY_ORDER[ticketPriorityOf(a.ticket)] - PRIORITY_ORDER[ticketPriorityOf(b.ticket)] || idNumberOf(a) - idNumberOf(b));
}

export function laneIsDividedByPriority(lane: KanbanLane, members: readonly KanbanCard[]): boolean {
  return !laneIsClosed(lane) && new Set(members.map((card) => ticketPriorityOf(card.ticket))).size > 1;
}

export function cardCarriesReviewedMark(card: KanbanCard): boolean {
  return card.ownRow !== null && deliveredAfterReview(card.ownRow, card.ticket.status);
}

/** One figure of a lane head; `dotState` draws the state's dot before it, `reviewedMark` the ✓. */
export interface LaneSubCount {
  count:        number;
  label:        string;
  dotState:     RowState | null;
  reviewedMark: boolean;
}

function subCount(count: number, label: string, dotState: RowState | null = null, reviewedMark = false): LaneSubCount {
  return {
    count,
    label,
    dotState,
    reviewedMark,
  };
}

/** The counts are independent, so a held ticket without a row counts as both; a zero count is left out. */
export function laneSubCountsOf(lane: KanbanLane, members: readonly KanbanCard[]): LaneSubCount[] {
  const countOf = (predicate: (card: KanbanCard) => boolean): number => members.filter(predicate).length;
  const counts: Record<KanbanLane, LaneSubCount[]> = {
    todo: [
      subCount(countOf((card) => card.waitingOn.length > 0), 'waiting'),
      subCount(countOf((card) => card.ticket.hold !== undefined), 'held'),
      subCount(countOf((card) => card.ownRow === null), 'no row'),
    ],
    progress: [
      subCount(countOf((card) => card.state === 'running'), 'wip', 'running'),
      subCount(countOf((card) => card.state === 'paused'), 'paused', 'paused'),
    ],
    review: [
      subCount(countOf((card) => card.state === 'finished'), 'awaiting', 'finished'),
      subCount(countOf((card) => card.state === 'reviewing' || card.state === 're-review'), 'reviewing', 'reviewing'),
    ],
    merge:     [],
    done:      [subCount(countOf(cardCarriesReviewedMark), 'reviewed first', null, true)],
    abandoned: [],
  };
  return counts[lane].filter((entry) => entry.count > 0);
}

function newestPhaseAt(task: Task | null, status: Task['status']): string | null {
  const phases = task?.history ?? [];
  return phases.findLast((phase) => phase.status === status)?.at ?? null;
}

function newestReviewRowOf(ticketId: string, tasks: readonly Task[]): Task | null {
  const ticketNumber = Number(ticketId);
  const reviewRows   = tasks.filter((task) => task.ticket === null && reviewedTicketNumberOf(task) === ticketNumber);
  return reviewRows.reduce<Task | null>((newest, task) => (newest === null || task.id > newest.id ? task : newest), null);
}

function stampNote(prefix: string, stamp: string | null | undefined, format: NoteFormat): string | null {
  return stamp === null || stamp === undefined || stamp === '' ? null : `${prefix} ${shortStampText(stamp, format.todayCalendarDate, format.slices)}`;
}

/** `null` for a stamp missing, unreadable or later than now, which a backfilled `--at` can write. */
function durationSince(stamp: string | null | undefined, format: NoteFormat): string | null {
  const epochMilliseconds = stamp === null || stamp === undefined ? Number.NaN : Date.parse(stamp);
  return Number.isNaN(epochMilliseconds) ? null : formatDuration(format.nowEpochMilliseconds - epochMilliseconds);
}

function pausedNote(card: KanbanCard, format: NoteFormat): string | null {
  const pausedAt = newestPhaseAt(card.ownRow, 'paused');
  const since    = stampNote('paused since', pausedAt, format);
  const duration = durationSince(pausedAt, format);
  return since === null || duration === null ? since : `${since} · ${duration}`;
}

function waitingForReviewerNote(card: KanbanCard, format: NoteFormat): string | null {
  const duration = durationSince(newestPhaseAt(card.ownRow, 'finished') ?? card.ticket.finished ?? card.ownRow?.end, format);
  return duration === null ? null : `no reviewer yet · ${duration}`;
}

function runningReviewerNote(card: KanbanCard, format: NoteFormat): string | null {
  const reviewRow = newestReviewRowOf(card.ticket.id, format.tasks);
  if (reviewRow === null || reviewRow.end !== null) {
    return null;
  }
  const round = card.state === 're-review' ? `round ${card.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND} reviewer since` : 'reviewer since';
  return stampNote(round, reviewRow.start, format);
}

/** What the lane and the pill cannot say on their own, or `null` where a source it reads is missing. */
export function subStateNoteOf(card: KanbanCard, format: NoteFormat): string | null {
  switch (card.state) {
    case 'paused':
      return pausedNote(card, format);
    case 'finished':
      return waitingForReviewerNote(card, format);
    case 'reviewing':
    case 're-review':
      return runningReviewerNote(card, format);
    case 'reviewed':
      return stampNote('reviewed', card.ownRow?.reviewed, format);
    case 'abandoned':
      return card.ticket.reason === undefined || card.ticket.reason === '' ? null : card.ticket.reason;
    default:
      return null;
  }
}

export function cappedLaneStorageKeyFor(trackerId: string, lane: ClosedKanbanLane): string {
  return `agent-progress:${trackerId}:kanban-${lane}-shown`;
}

export function abandonedLaneStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}:kanban-abandoned`;
}

export function abandonedLaneIsOpenFrom(stored: string | null): boolean {
  return stored === ABANDONED_LANE_OPEN_CHOICE;
}

/** The closed choice is the default, which the page stores by removing the key. */
export function abandonedLaneChoiceFor(laneIsOpen: boolean): string {
  return laneIsOpen ? ABANDONED_LANE_OPEN_CHOICE : DEFAULT_ABANDONED_LANE_CHOICE;
}

/** A stored count is clamped to the first page … the lane's count, so a lane that shrank under Hide never shows an empty page. */
export function cappedLaneShownCount(requested: number, laneCount: number): number {
  const wholeRequest = Number.isSafeInteger(requested) ? requested : CAPPED_LANE_FIRST_PAGE;
  return Math.max(CAPPED_LANE_FIRST_PAGE, Math.min(wholeRequest, laneCount));
}

export function shownCountFrom(stored: string | null): number {
  return stored === null ? CAPPED_LANE_FIRST_PAGE : Number(stored);
}

export function nextPageSizeFor(shownCount: number, laneCount: number): number {
  return Math.min(CAPPED_LANE_PAGE_STEP, laneCount - shownCount);
}

export function shownCountAfterMore(shownCount: number, laneCount: number): number {
  return cappedLaneShownCount(shownCount + CAPPED_LANE_PAGE_STEP, laneCount);
}

/** `start`, `end`, both space-separated, or `null` when the board fits: the directions the board can still scroll. */
export function overflowDirectionsOf(scrollLeft: number, scrollWidth: number, clientWidth: number): string | null {
  const scrollableWidth = scrollWidth - clientWidth;
  const directions      = [
    ...scrollLeft > OVERFLOW_TOLERANCE_PIXELS ? ['start'] : [],
    ...scrollLeft < scrollableWidth - OVERFLOW_TOLERANCE_PIXELS ? ['end'] : [],
  ];
  return directions.length === 0 ? null : directions.join(' ');
}
