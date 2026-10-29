/** Small synthetic `BoardState`s holding exactly what the Tickets view and the detail panel read, for their model specs and DOM specs. */
import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';
import type {
  TicketsBoardState,
  TicketsLogEntry,
  TicketsTaskDocument,
  TicketsTicketDocument
} from '../@types/TicketsBoardState.ts';
import { EXAMPLE_PAGE_LIMITS } from './TimestampSlicesFixture.ts';

export function exampleTicketsTicket(id: string, fields: Partial<TicketsTicketDocument> = {}): TicketsTicketDocument {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'pending',
    task:        null,
    filed:       '2026-09-18T09:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    bodyHtml:    `<p>Body of example ticket ${id}.</p>`,
    ...fields,
  };
}

export interface ExampleTicketsBoardFields {
  readonly tickets:        readonly TicketsTicketDocument[];
  /** The display state the Board reports, where it differs from the stored status. */
  readonly displayStates?: Readonly<Record<string, DisplayState>>;
  readonly waitingOn?:     Readonly<Record<string, readonly string[]>>;
  /** Each ticket's own row; its position in the list is its `ownRowPosition`. */
  readonly ownRows?:       Readonly<Record<string, TicketsTaskDocument>>;
  readonly log?:           readonly TicketsLogEntry[];
  readonly withoutEpics?:  boolean;
}

export function exampleTicketsBoard(fields: ExampleTicketsBoardFields): TicketsBoardState {
  const ownRowEntries = Object.entries(fields.ownRows ?? {});
  return {
    page: {
      tickets: fields.tickets,
      payload: {
        progress:   { tasks: ownRowEntries.map(([, row]) => row), log: fields.log ?? [] },
        limits:     EXAMPLE_PAGE_LIMITS,
        boardFacts: {
          tickets: fields.tickets.map((ticket) => {
            const position = ownRowEntries.findIndex(([ticketId]) => ticketId === ticket.id);
            return {
              ticketId:           ticket.id,
              ownRowPosition:     position === -1 ? null : position,
              displayState:       fields.displayStates?.[ticket.id] ?? ticket.status,
              waitingOnTicketIds: fields.waitingOn?.[ticket.id] ?? [],
            };
          }),
          epics: fields.withoutEpics === true
            ? []
            : [{ key: 'billing', title: 'Example billing', slot: 4 }, { key: 'checkout', title: 'Example checkout', slot: 2 }],
        },
      },
    },
  };
}
