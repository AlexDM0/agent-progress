/** The fields of the Overseer's `BoardState` the Progress chart and the dependencies view read, exactly those, so the document satisfies it. */
import type { DisplayState, TaskPhase, TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';
import type {
  TicketPriority,
  TicketSize,
  TicketStatus,
  TicketType
} from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { ViewRange }                      from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { DurationUnits, TimestampSlices } from '../utils/TimeUtil.ts';
import type { TimelineLimits }                 from './Timeline.ts';

export interface ProgressTaskDocument {
  readonly id:              number;
  readonly name:            string;
  readonly status:          TaskStatus;
  readonly start:           string | null;
  readonly end:             string | null;
  readonly ticket:          string | null;
  readonly tokens:          number | null;
  readonly reviewed?:       string;
  readonly reviewRound?:    number;
  readonly history?:        readonly TaskPhase[];
  readonly reviewOf?:       string;
  readonly reviewBarRound?: number;
}

/** One per row of `progress.tasks`, at the same index: the Board's answer to which rows are review bars, and of which ticket's own row. */
export interface ProgressRowFacts {
  readonly displayState:                   DisplayState;
  readonly deliveredRowCountsAsReviewed:   boolean;
  readonly ownRowPositionOfReviewedTicket: number | null;
}

export interface ProgressTicketFacts {
  readonly ticketId:           string;
  readonly ownRowPosition:     number | null;
  /** Oldest filed first. */
  readonly reviewBarPositions: readonly number[];
  readonly displayState:       DisplayState;
  readonly waitingOnTicketIds: readonly string[];
}

export interface ProgressTicketDocument {
  readonly id:         string;
  readonly title:      string;
  readonly type:       TicketType;
  readonly status:     TicketStatus;
  readonly priority?:  TicketPriority;
  readonly size?:      TicketSize;
  readonly hold?:      string;
  readonly dependsOn?: readonly string[];
  readonly epics?:     readonly string[];
}

export interface ProgressBoardState {
  readonly page: {
    readonly tickets: readonly ProgressTicketDocument[];
    readonly payload: {
      readonly progress: {
        readonly startedAt:        string;
        readonly view:             ViewRange;
        readonly tasks:            readonly ProgressTaskDocument[];
        readonly dispatcherState?: string;
      };
      readonly limits:      TimelineLimits & TimestampSlices & DurationUnits;
      readonly concurrency: { readonly limit: number };
      readonly boardFacts: {
        readonly rows:         readonly ProgressRowFacts[];
        readonly tickets:      readonly ProgressTicketFacts[];
        readonly readyTickets: readonly { readonly id: string; readonly held?: boolean }[];
      };
    };
  };
}
