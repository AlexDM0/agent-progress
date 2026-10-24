/**
 * The words the Kanban lane heads and cards print beyond the title: the heads' counts, a working or waiting card's stamp and a card's
 * sub-state note. The page's now is handed in: the clock while the page is live, its generation once it is a snapshot.
 */

import type { DisplayState, Task }       from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }     from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { KanbanCard }               from '../@types/KanbanCard.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { ElapsedTimeUtil }               from '../utils/ElapsedTimeUtil.ts';
import type { PauseTextFormat }          from '../utils/PauseTextUtil.ts';
import { PauseTextUtil }                 from '../utils/PauseTextUtil.ts';
import { TimeUtil }                      from '../utils/TimeUtil.ts';
import type { ShortenedTexts }           from '../utils/WorkItemMarkupUtil.ts';
import type { KanbanLane }               from './@types/KanbanLane.ts';
import type { LaneCardElapsedStamp }     from './@types/LaneBoard.ts';

export type NoteFormat = PauseTextFormat;

/** One figure of a lane head; `dotState` draws the state's dot before it, `reviewedMark` the ✓. */
export interface LaneSubCount {
  count:        number;
  label:        string;
  dotState:     DisplayState | null;
  reviewedMark: boolean;
}

function subCount(count: number, label: string, dotState: DisplayState | null = null, reviewedMark = false): LaneSubCount {
  return {
    count,
    label,
    dotState,
    reviewedMark,
  };
}

function countWordOf(state: DisplayState): string {
  return STATE_LABEL_FOR_DISPLAY_STATE[state].toLowerCase();
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
      subCount(countOf((card) => card.state === 'in-progress'), countWordOf('in-progress'), 'in-progress'),
      subCount(countOf((card) => card.state === 'paused'), countWordOf('paused'), 'paused'),
    ],
    review: [
      subCount(countOf((card) => card.state === 'in-review'), countWordOf('in-review'), 'in-review'),
      subCount(countOf((card) => card.state === 'reviewing' || card.state === 're-review'), countWordOf('reviewing'), 'reviewing'),
    ],
    merge:     [],
    done:      [subCount(countOf((card) => card.ownRow?.deliveredRowCountsAsReviewed === true), 'reviewed first', null, true)],
    abandoned: [],
  };
  return counts[lane].filter((entry) => entry.count > 0);
}

function newestPhaseAt(task: Task | null, status: Task['status']): string | null {
  const phases = task?.history ?? [];
  return phases.findLast((phase) => phase.status === status)?.at ?? null;
}

function stampNote(prefix: string, stamp: string | null | undefined, format: NoteFormat): string | null {
  return stamp === null || stamp === undefined || stamp === '' ? null : `${prefix} ${TimeUtil.shortStampText(stamp, format.todayCalendarDate, format.slices)}`;
}

/** A stamp the card prints instead of its newest milestone, and what the page's ticker re-measures it from when it ticks. */
export interface WorkStamp {
  stamp:        ShortenedTexts;
  elapsedStamp: LaneCardElapsedStamp | null;
}

/** Indexed by the last digit; a digit past the list takes `th`. */
const ORDINAL_SUFFIX_BY_LAST_DIGIT: readonly string[] = ['th', 'st', 'nd', 'rd'];
const TEEN_ORDINALS = { first: 11, last: 13, modulus: 100 } as const;
const DECIMAL_BASE  = 10;

/** `2nd`, `3rd`, `11th`, `21st`. */
function ordinalOf(round: number): string {
  const lastTwoDigits = round % TEEN_ORDINALS.modulus;
  const isTeen        = lastTwoDigits >= TEEN_ORDINALS.first && lastTwoDigits <= TEEN_ORDINALS.last;
  const suffix        = isTeen ? undefined : ORDINAL_SUFFIX_BY_LAST_DIGIT[round % DECIMAL_BASE];
  return `${round}${suffix ?? 'th'}`;
}

/** What a working card's ticking stamp says before its time: the round of a repeat review, "reviewing" or "building". */
function workLabelOf(card: KanbanCard): string {
  if (card.state === 're-review') {
    return `${ordinalOf(card.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND)} round`;
  }
  return card.state === 'in-progress' ? 'building' : 'reviewing';
}

/** A build runs from its row's start, as the activity banner measures it; a review from its newest review row's, while that row runs. */
function workStartOf(card: KanbanCard): string | null {
  if (card.state === 'in-progress') {
    return card.ownRow?.start ?? null;
  }
  const reviewRow = card.reviewBars.at(-1) ?? null;
  return reviewRow === null || reviewRow.end !== null ? null : reviewRow.start;
}

function tickingStampOf(card: KanbanCard, format: NoteFormat): WorkStamp | null {
  const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(workStartOf(card));
  if (startEpochMilliseconds === null) {
    return null;
  }
  const label = workLabelOf(card);
  const text  = ElapsedTimeUtil.labelledElapsedTextOf(label, startEpochMilliseconds, format.nowEpochMilliseconds, format.slices);
  return { stamp: { shortText: text, fullText: text }, elapsedStamp: { label, startEpochMilliseconds } };
}

/** "paused 1h 51m", its full stamp in the hover; `null` for a stamp missing, unreadable or later than now, which a backfilled `--at` can write. */
function waitingStampOf(label: string, since: string | null | undefined, format: NoteFormat): WorkStamp | null {
  const epochMilliseconds = TimeUtil.epochMillisecondsOf(since);
  const duration          = epochMilliseconds === null ? null : TimeUtil.formatDuration(format.nowEpochMilliseconds - epochMilliseconds, format.slices);
  if (since === null || since === undefined || duration === null) {
    return null;
  }
  return { stamp: { shortText: `${label} ${duration}`, fullText: `${label} since ${TimeUtil.fullStampText(since, format.slices)}` }, elapsedStamp: null };
}

/**
 * What In progress and Review cards print instead of a milestone: a working card's time at work, ticking, and how long a paused or
 * awaiting-review card has waited. `null` for any other card, or where a source it reads is missing.
 */
export function workStampOf(card: KanbanCard, format: NoteFormat): WorkStamp | null {
  switch (card.state) {
    case 'in-progress':
    case 'reviewing':
    case 're-review':
      return tickingStampOf(card, format);
    case 'paused':
      return waitingStampOf('paused', PauseTextUtil.pausedStampOf(card.ownRow), format);
    case 'in-review':
      return waitingStampOf('waiting', newestPhaseAt(card.ownRow, 'in-review') ?? card.ticket.finished ?? card.ownRow?.end, format);
    default:
      return null;
  }
}

/** What the lane and the stamp cannot say on their own, or `null` where a source it reads is missing. */
export function subStateNoteOf(card: KanbanCard, format: NoteFormat): string | null {
  switch (card.state) {
    case 'reviewed':
      return stampNote('reviewed', card.ownRow?.reviewed, format);
    case 'abandoned':
      return card.ticket.reason === undefined || card.ticket.reason === '' ? null : card.ticket.reason;
    default:
      return null;
  }
}
