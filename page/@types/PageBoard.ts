import type { DraftSummary }       from '../../src/lib/tracker-model/@types/Draft.ts';
import type { EpicRollup }         from '../../src/lib/tracker-model/@types/Epic.ts';
import type { DisplayState, Task } from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }         from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';

/** A task of the progress island with the Board's facts about it, zipped on by position when the island is read. */
export interface BoardRow extends Task {
  displayState:                 DisplayState;
  deliveredRowCountsAsReviewed: boolean;
  /** For a review bar, its ticket's own row; null for every other row. */
  ownRowOfReviewedTicket:       BoardRow | null;
  /** The type of the ticket this is the own row of; absent on every other row. */
  ticketType?:                  TicketType;
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

/** An open draft's summary with its request, empty when the island carries none for it. */
export interface BoardDraft extends DraftSummary {
  request: string;
}

export interface PageBoard {
  /** Every open draft the island could read, in draft-number order. */
  drafts:         readonly BoardDraft[];
  rows:           readonly BoardRow[];
  tickets:        readonly BoardTicket[];
  /** Ordered by key, as the Board rolls them up. */
  epics:          readonly BoardEpic[];
  /** The Board's ready tickets less the held ones: the only source of "ready" on the page. */
  readyTicketIds: ReadonlySet<string>;
}
