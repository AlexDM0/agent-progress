/** The tracker page's Waves tab: its tickets as the shared wave graph's nodes, with the board's slot meter and its Done wording. */

import type { DependencyGraph }                                                 from '../@types/DependencyGraph.ts';
import type { BoardTicket }                                                     from '../@types/PageBoard.ts';
import type { DependencyGraphOptions, DependencyNodeChip, DependencyNodeModel } from './WaveGraphMarkup.ts';
import { waveGraphMarkup }                                                      from './WaveGraphMarkup.ts';

function boardHasDependencies(tickets: readonly BoardTicket[]): boolean {
  return tickets.some((ticket) => (ticket.dependsOn ?? []).length > 0);
}

/** Ready only as the Board lists it; a held pending ticket wears the held chip instead, and a low one nothing. */
function chipsOf(ticket: BoardTicket, readyTicketIds: ReadonlySet<string>): DependencyNodeChip[] {
  if (readyTicketIds.has(ticket.id)) {
    return [{ kind: 'ready' }];
  }
  if (ticket.status === 'pending' && ticket.hold !== undefined) {
    return [{ kind: 'held', reason: ticket.hold }];
  }
  if (ticket.status !== 'in-progress' && ticket.status !== 'in-review') {
    return [];
  }
  return [{ kind: 'state', displayState: ticket.displayState }];
}

function dependencyNodeOf(ticket: BoardTicket, readyTicketIds: ReadonlySet<string>): DependencyNodeModel {
  return {
    id:         ticket.id,
    idLabel:    `#${ticket.id}`,
    title:      ticket.title,
    dependsOn:  ticket.dependsOn ?? [],
    tone:       ticket.displayState,
    isInReview: ticket.status === 'in-review',
    chips:      chipsOf(ticket, readyTicketIds),
  };
}

function trackerGraphOptionsOf(ticketById: ReadonlyMap<string, BoardTicket>): DependencyGraphOptions {
  return {
    showsSlots:      true,
    doneCountTextOf: (doneTicketIds) => {
      const deliveredCount = doneTicketIds.filter((ticketId) => ticketById.get(ticketId)?.status === 'delivered').length;
      const reviewedCount  = doneTicketIds.length - deliveredCount;
      return reviewedCount === 0 ? `${deliveredCount} delivered` : `${deliveredCount} delivered · ${reviewedCount} awaiting merge`;
    },
    openAttribute: 'data-open-ticket',
    emptyText:     'No open ticket waits on another.',
  };
}

function dependencyGraphMarkup(graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>, readyTicketIds: ReadonlySet<string>): string {
  const nodeById = new Map([...ticketById].map(([ticketId, ticket]) => [ticketId, dependencyNodeOf(ticket, readyTicketIds)] as const));
  return waveGraphMarkup(graph, nodeById, trackerGraphOptionsOf(ticketById));
}

export const DependencyMarkup = { boardHasDependencies, dependencyNodeOf, dependencyGraphMarkup } as const;
