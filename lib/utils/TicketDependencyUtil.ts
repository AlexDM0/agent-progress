/** Which tickets another ticket still waits on, and whether a new dependency list would close a loop. Shared by the command surface and the page. */
import { TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY } from '../constants/Statuses.ts';
import type { TicketStatus }                        from '../constants/Types.ts';

/** A dependency that is missing from `statusById` still counts as unsettled: a ticket nobody can see is not finished work. */
function unsettledDependenciesOf(dependsOn: readonly string[], statusById: ReadonlyMap<string, TicketStatus>): string[] {
  return dependsOn.filter((dependencyId) => {
    const status = statusById.get(dependencyId);
    return status === undefined || !TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY.includes(status);
  });
}

/** The loop as a list of ids from `ticketId` back to itself, or `null` when giving `ticketId` this list closes none. */
function dependencyLoopFrom(ticketId: string, dependsOn: readonly string[], dependsOnById: ReadonlyMap<string, readonly string[]>): string[] | null {
  const visited = new Set<string>();

  const pathBackTo = (currentId: string): string[] | null => {
    if (currentId === ticketId) return [currentId];
    if (visited.has(currentId)) return null;
    visited.add(currentId);
    for (const nextId of dependsOnById.get(currentId) ?? []) {
      const rest = pathBackTo(nextId);
      if (rest !== null) return [currentId, ...rest];
    }
    return null;
  };

  for (const dependencyId of dependsOn) {
    const path = pathBackTo(dependencyId);
    if (path !== null) return [ticketId, ...path];
  }
  return null;
}

/** The open tickets whose every dependency is done or delivered, lowest id first: what an agent could claim next. */
function readyTicketIdsOf(tickets: readonly { id: string; status: TicketStatus; dependsOn?: readonly string[] }[]): string[] {
  const statusById = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  return tickets
    .filter((ticket) => ticket.status === 'open' && unsettledDependenciesOf(ticket.dependsOn ?? [], statusById).length === 0)
    .map((ticket) => ticket.id)
    .sort((a, b) => Number(a) - Number(b));
}

export const TicketDependencyUtil = {
  unsettledDependenciesOf,
  dependencyLoopFrom,
  readyTicketIdsOf,
} as const;
