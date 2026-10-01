/** The shape of the progress island, which the render side writes and the page reads. */

import type { EpicRollup }             from '../../lib/tracker-model/@types/Epic.ts';
import type { DisplayState }           from '../../lib/tracker-model/@types/Task.ts';
import type { TicketFrontmatter }      from '../../lib/tracker-model/@types/Ticket.ts';
import type { IdentifiedLogEntry }     from './WordedLogEntry.ts';
import type { WordedProgressDocument } from './WordedProgressDocument.ts';

export interface PageLimits {
  tickStepLadderMinutes:      readonly number[];
  maximumTicksPerAxis:        number;
  axisMinimumSpanMinutes:     number;
  axisPaddingMinutes:         number;
  minimumBarWidthPercent:     number;
  hoursAxisLabelLimitMinutes: number;
  weekAxisLabelLimitMinutes:  number;
  hourMinutes:                number;
  dayMinutes:                 number;
  tickCountSafetyBound:       number;
  dateAndClockLength:         number;
  calendarDateLength:         number;
  monthAndDaySliceStart:      number;
  clockSliceStart:            number;
  clockSliceEnd:              number;
}

/** The two figures of `status --json`'s `concurrency` block the page shows, computed Bun-side by the same function. */
export interface PageConcurrency {
  limit:          number;
  agentsInFlight: number;
}

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
  /** Empty for a closed ticket and for one whose dependencies are all settled. */
  waitingOnTicketIds: string[];
}

/** The Board's answers the progress island carries as its last key. */
export interface PageBoardFacts {
  rows:    PageRowFacts[];
  tickets: PageTicketFacts[];
  /** Every epic with its roll-up, ordered by key, as `status --json` prints them; a ticket's own list is its `epics`. */
  epics:   EpicRollup[];
}

export interface PagePayload {
  progress:                     WordedProgressDocument<IdentifiedLogEntry>;
  generatedAtEpochMilliseconds: number;
  limits:                       PageLimits;
  concurrency:                  PageConcurrency;
  pageScriptFailure:            string | null;
  boardFacts:                   PageBoardFacts;
}

export interface PageTicket extends TicketFrontmatter {
  filePath: string;
  bodyHtml: string;
}
