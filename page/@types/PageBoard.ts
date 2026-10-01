import type { EpicRollup }         from '../../src/lib/tracker-model/@types/Epic.ts';
import type { DisplayState, Task } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';

/** A task of the progress island with the Board's facts about it, zipped on by position when the island is read. */
export interface BoardRow extends Task {
  displayState:                 DisplayState;
  deliveredRowCountsAsReviewed: boolean;
  /** For a review bar, its ticket's own row; null for every other row. */
  ownRowOfReviewedTicket:       BoardRow | null;
}

/** An epic's roll-up with its rendered description, empty when the island carries none for it. */
export interface BoardEpic extends EpicRollup {
  descriptionHtml: string;
}

export interface BoardTicket extends PageTicket {
  ownRow:        BoardRow | null;
  /** Oldest filed first. */
  reviewBars:    readonly BoardRow[];
  displayState:  DisplayState;
  waitingOn:     readonly string[];
  /** The epics of the ticket's `epics` list the board knows, its primary epic first. */
  memberOfEpics: readonly BoardEpic[];
}

export interface PageBoard {
  rows:    readonly BoardRow[];
  tickets: readonly BoardTicket[];
  /** Ordered by key, as the Board rolls them up. */
  epics:   readonly BoardEpic[];
}
