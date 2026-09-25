import { TicketDependencyUtil }   from '../../src/lib/tracker-model/utils/TicketDependencyUtil.ts';
import type { PageTicket }        from '../../src/shared/@types/PagePayload.ts';
import { CLOSED_TICKET_STATUSES } from '../constants/TicketStatusGroups.ts';

/** Only tickets still to be worked on wait; a closed ticket's list is history. */
function waitingOnByTicketId(tickets: readonly PageTicket[]): Map<string, string[]> {
  const statusById = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  const waitingOn  = new Map<string, string[]>();
  for (const ticket of tickets) {
    if (CLOSED_TICKET_STATUSES.includes(ticket.status)) continue;
    const unsettled = TicketDependencyUtil.unsettledDependenciesOf(ticket.dependsOn ?? [], statusById);
    if (unsettled.length > 0) waitingOn.set(ticket.id, unsettled);
  }
  return waitingOn;
}

export const WaitingOnUtil = { waitingOnByTicketId } as const;
