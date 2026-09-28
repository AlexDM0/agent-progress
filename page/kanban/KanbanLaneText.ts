/** The words the Kanban lane heads and cards print beyond the pill: the heads' counts and a card's sub-state note. The page's now is handed in. */

import type { DisplayState, Task }             from '../../src/lib/tracker-model/@types/Task.ts';
import { FIRST_REPEAT_REVIEW_ROUND }           from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { KanbanCard }                     from '../@types/KanbanCard.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }       from '../constants/StateLabels.ts';
import type { DurationUnits, TimestampSlices } from '../utils/TimeUtil.ts';
import { TimeUtil }                            from '../utils/TimeUtil.ts';
import type { KanbanLane }                     from './@types/KanbanLane.ts';

export interface NoteFormat {
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  slices:               TimestampSlices & DurationUnits;
}

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

/** `null` for a stamp missing, unreadable or later than now, which a backfilled `--at` can write. */
function durationSince(stamp: string | null | undefined, format: NoteFormat): string | null {
  const epochMilliseconds = TimeUtil.epochMillisecondsOf(stamp);
  return epochMilliseconds === null ? null : TimeUtil.formatDuration(format.nowEpochMilliseconds - epochMilliseconds, format.slices);
}

function pausedNote(card: KanbanCard, format: NoteFormat): string | null {
  const pausedAt = newestPhaseAt(card.ownRow, 'paused');
  const since    = stampNote('paused since', pausedAt, format);
  const duration = durationSince(pausedAt, format);
  return since === null || duration === null ? since : `${since} · ${duration}`;
}

function waitingForReviewerNote(card: KanbanCard, format: NoteFormat): string | null {
  const duration = durationSince(newestPhaseAt(card.ownRow, 'in-review') ?? card.ticket.finished ?? card.ownRow?.end, format);
  return duration === null ? null : `no reviewer yet · ${duration}`;
}

function runningReviewerNote(card: KanbanCard, format: NoteFormat): string | null {
  const reviewRow = card.reviewBars.at(-1) ?? null;
  if (reviewRow === null || reviewRow.end !== null) {
    return null;
  }
  const notePrefix = card.state === 're-review' ? `round ${card.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND} reviewer since` : 'reviewer since';
  return stampNote(notePrefix, reviewRow.start, format);
}

/** What the lane and the pill cannot say on their own, or `null` where a source it reads is missing. */
export function subStateNoteOf(card: KanbanCard, format: NoteFormat): string | null {
  switch (card.state) {
    case 'paused':
      return pausedNote(card, format);
    case 'in-review':
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
