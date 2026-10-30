/** The fields of the Overseer's `BoardState` the Tickets view and the detail panel read, exactly those, so the state document satisfies it unchanged. */
import type { DisplayState, TaskStatus }                 from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority, TicketStatus, TicketType } from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { DurationUnits, TimestampSlices }           from '../utils/TimeUtil.ts';

export interface TicketsTicketDocument {
  readonly id:          string;
  readonly title:       string;
  readonly type:        TicketType;
  readonly status:      TicketStatus;
  readonly priority?:   TicketPriority;
  readonly hold?:       string;
  readonly epics?:      readonly string[];
  readonly group?:      string;
  readonly branch?:     string;
  readonly commit?:     string;
  readonly reason?:     string;
  readonly network?:    readonly string[];
  readonly task:        number | null;
  readonly filed:       string;
  readonly started:     string | null;
  readonly finished:    string | null;
  readonly delivered:   string | null;
  readonly abandonedAt: string | null;
  /** Marked output of the ticket's body: agent-written, so it reaches the DOM only inside a sandboxed frame. */
  readonly bodyHtml:    string;
}

export interface TicketsTicketFacts {
  readonly ticketId:           string;
  readonly ownRowPosition:     number | null;
  readonly displayState:       DisplayState;
  readonly waitingOnTicketIds: readonly string[];
}

export interface TicketsEpicDocument {
  readonly key:   string;
  readonly title: string;
  readonly slot:  number;
}

export interface TicketsTaskDocument {
  readonly id:           number;
  readonly status:       TaskStatus;
  readonly note:         string;
  readonly reviewed?:    string;
  readonly reviewRound?: number;
  readonly history?:     readonly { readonly status: TaskStatus; readonly at: string }[];
}

/** A worded log line: one worded from a record carries both id lists, a note carries neither. */
export interface TicketsLogEntry {
  readonly at:         string;
  readonly text:       string;
  readonly taskIds?:   readonly number[];
  readonly ticketIds?: readonly string[];
}

export interface TicketsBoardState {
  readonly page: {
    readonly tickets: readonly TicketsTicketDocument[];
    readonly payload: {
      readonly progress:   { readonly tasks: readonly TicketsTaskDocument[]; readonly log: readonly TicketsLogEntry[] };
      readonly limits:     TimestampSlices & DurationUnits;
      readonly boardFacts: {
        readonly tickets: readonly TicketsTicketFacts[];
        readonly epics:   readonly TicketsEpicDocument[];
      };
    };
  };
}
