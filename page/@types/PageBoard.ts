import type { DisplayState, Task } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';

/** A task of the progress island with the Board's facts about it, zipped on by position when the island is read. */
export interface BoardRow extends Task {
  displayState:                 DisplayState;
  deliveredRowCountsAsReviewed: boolean;
  /** For a review bar, its ticket's own row; null for every other row. */
  ownRowOfReviewedTicket:       BoardRow | null;
}

export interface BoardTicket extends PageTicket {
  ownRow:       BoardRow | null;
  /** Oldest filed first. */
  reviewBars:   readonly BoardRow[];
  displayState: DisplayState;
  waitingOn:    readonly string[];
}

export interface PageBoard {
  rows:    readonly BoardRow[];
  tickets: readonly BoardTicket[];
}
