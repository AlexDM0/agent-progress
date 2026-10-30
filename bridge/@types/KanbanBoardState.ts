/** The fields of the Overseer's `BoardState` the Kanban reads, exactly those, so the state document satisfies it unchanged. */
import type { DraftState }   from '../../src/lib/tracker-model/@types/Draft.ts';
import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';
import type {
  TicketPriority,
  TicketSize,
  TicketStatus,
  TicketType
} from '../../src/lib/tracker-model/@types/Ticket.ts';

export interface KanbanTicketDocument {
  readonly id:          string;
  readonly title:       string;
  readonly type:        TicketType;
  readonly status:      TicketStatus;
  readonly priority?:   TicketPriority;
  readonly size?:       TicketSize;
  readonly hold?:       string;
  readonly epics?:      readonly string[];
  readonly dependsOn?:  readonly string[];
  readonly delivered:   string | null;
  readonly abandonedAt: string | null;
}

export interface KanbanTicketFacts {
  readonly ticketId:           string;
  readonly ownRowPosition:     number | null;
  readonly displayState:       DisplayState;
  readonly waitingOnTicketIds: readonly string[];
}

export interface KanbanEpicDocument {
  readonly key:   string;
  readonly title: string;
  readonly slot:  number;
}

export interface KanbanReadyTicket {
  readonly id:    string;
  readonly held?: true;
}

/** A filing cabinet's draft, which is no ticket yet. */
export interface KanbanFilingDraft {
  readonly id:                string;
  readonly title:             string;
  readonly state:             DraftState;
  readonly openQuestionCount: number;
}

export interface KanbanBoardState {
  readonly page: {
    readonly tickets: readonly KanbanTicketDocument[];
    readonly payload: {
      readonly concurrency: { readonly limit: number };
      readonly progress:    { readonly tasks: readonly { readonly tokens?: number }[] };
      readonly boardFacts: {
        readonly tickets:      readonly KanbanTicketFacts[];
        readonly epics:        readonly KanbanEpicDocument[];
        readonly readyTickets: readonly KanbanReadyTicket[];
        readonly drafts?:      readonly KanbanFilingDraft[];
      };
    };
  };
  readonly mergeQueue: { readonly queuedTicketIds: readonly string[] };
}
