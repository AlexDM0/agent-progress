/** A group's release bundle as the dispatcher reads it off the board: its open release ticket and every ticket of the group it depends on. */
import type { ReleaseBundleTicket } from '../../@types/AgentReadings.ts';

function releaseTicketOf<Ticket extends ReleaseBundleTicket>(groupTickets: readonly Ticket[]): Ticket | undefined {
  return groupTickets.find((ticket) => ticket.releasesGroup && ticket.status !== 'delivered' && ticket.status !== 'abandoned');
}

// A dependency outside the group is not followed.
function bundleOf<Ticket extends ReleaseBundleTicket>(groupTickets: readonly Ticket[], releaseTicket: Ticket): Ticket[] {
  const bundle = new Map<string, Ticket>();
  const pending = [releaseTicket.id];
  while (pending.length > 0) {
    const ticketId = pending.pop() ?? '';
    const ticket = groupTickets.find((groupTicket) => groupTicket.id === ticketId);
    if (ticket === undefined || bundle.has(ticketId)) continue;
    bundle.set(ticketId, ticket);
    pending.push(...ticket.dependsOn);
  }
  return [...bundle.values()];
}

// Empty while the group has no open release ticket.
function releaseBundleIdsOf(groupTickets: readonly ReleaseBundleTicket[]): string[] {
  const releaseTicket = releaseTicketOf(groupTickets);
  return releaseTicket === undefined ? [] : bundleOf(groupTickets, releaseTicket).map((ticket) => ticket.id);
}

export const ReleaseBundleUtil = {
  releaseTicketOf,
  bundleOf,
  releaseBundleIdsOf,
} as const;
