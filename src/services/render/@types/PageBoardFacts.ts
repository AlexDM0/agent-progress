/** The Board's answers the progress island carries as its last key, `boardFacts`, beside the render service until the page reads them. */
import type { DisplayState } from '../../../lib/tracker-model/@types/Task.ts';

/** One per row of `progress.tasks`, at the same index; the page zips them onto the tasks when it reads the island, before any filtering. */
export interface PageRowFacts {
  displayState:                   DisplayState;
  deliveredRowCountsAsReviewed:   boolean;
  /** For a review bar: where its ticket's own row is in `progress.tasks`, or null; null for every other row. */
  ownRowPositionOfReviewedTicket: number | null;
}

/** Joined to the tickets island by `ticketId`, never by position: the page drops unusable ticket entries. */
export interface PageTicketFacts {
  ticketId:           string;
  ownRowPosition:     number | null;
  /** Oldest filed first. */
  reviewBarPositions: number[];
  displayState:       DisplayState;
}

export interface PageBoardFacts {
  rows:    PageRowFacts[];
  tickets: PageTicketFacts[];
}
