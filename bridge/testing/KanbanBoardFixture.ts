/** Small synthetic `BoardState`s holding exactly what the Kanban reads, for its view-model specs and its DOM spec. */
import type { KanbanBoardState, KanbanTicketDocument } from '../@types/KanbanBoardState.ts';

export function exampleTicket(id: string, fields: Partial<KanbanTicketDocument> = {}): KanbanTicketDocument {
  return {
    id, title: `Example ticket ${id}`, type: 'ticket', status: 'pending', delivered: null, abandonedAt: null, ...fields
  };
}

export interface ExampleBoardFields {
  readonly tickets:          readonly KanbanTicketDocument[];
  readonly readyTicketIds?:  readonly string[];
  readonly queuedTicketIds?: readonly string[];
  readonly waitingOn?:       Readonly<Record<string, readonly string[]>>;
  readonly tokensById?:      Readonly<Record<string, number>>;
}

export function exampleBoard(fields: ExampleBoardFields): KanbanBoardState {
  const tokenEntries = Object.entries(fields.tokensById ?? {});
  return {
    page: {
      tickets: fields.tickets,
      payload: {
        concurrency: { limit: 4 },
        progress:    { tasks: tokenEntries.map(([, tokens]) => ({ tokens })) },
        boardFacts:  {
          tickets: fields.tickets.map((ticket) => {
            const position = tokenEntries.findIndex(([ticketId]) => ticketId === ticket.id);
            return {
              ticketId:           ticket.id,
              ownRowPosition:     position === -1 ? null : position,
              displayState:       ticket.status,
              waitingOnTicketIds: fields.waitingOn?.[ticket.id] ?? [],
            };
          }),
          epics:        [{ key: 'checkout', title: 'Example checkout', slot: 2 }, { key: 'billing', title: 'Example billing', slot: 4 }],
          readyTickets: (fields.readyTicketIds ?? []).map((id) => ({ id })),
          drafts:       [{
            id: 'D7', title: 'Example filing draft', state: 'waiting', openQuestionCount: 2
          }],
        },
      },
    },
    mergeQueue: { queuedTicketIds: fields.queuedTicketIds ?? [] },
  };
}
