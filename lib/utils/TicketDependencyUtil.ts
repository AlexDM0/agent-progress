/** Which tickets another ticket still waits on, and whether a new dependency list would close a loop. Shared by the command surface and the page. */
import { TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY, ticketPriorityOf } from '../constants/Statuses.ts';
import type { TicketPriority, TicketStatus }                          from '../constants/Types.ts';

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

interface ReadinessTicket {
  id:         string;
  status:     TicketStatus;
  priority?:  TicketPriority;
  dependsOn?: readonly string[];
}

/** Low work waits for these, and only these: a ticket that is done is still owed a merge, so it holds the low queue back too. */
const TICKET_STATUSES_THAT_RELEASE_LOW_PRIORITY_WORK: readonly TicketStatus[] = ['delivered', 'abandoned'];

const PRIORITY_RANK: Record<TicketPriority, number> = { high: 0, normal: 1, low: 2 };

/** The normal and high tickets that are neither delivered nor abandoned, lowest id first; while any is left, no low ticket is ready. */
function ticketsHoldingBackLowPriorityWork(tickets: readonly ReadinessTicket[]): string[] {
  return tickets
    .filter((ticket) => ticketPriorityOf(ticket) !== 'low' && !TICKET_STATUSES_THAT_RELEASE_LOW_PRIORITY_WORK.includes(ticket.status))
    .map((ticket) => ticket.id)
    .sort((a, b) => Number(a) - Number(b));
}

/**
 * The open tickets whose every dependency is done or delivered — high before normal, then lowest id first — that an agent could claim next.
 * Low tickets are among them only once `ticketsHoldingBackLowPriorityWork` is empty.
 */
function readyTicketIdsOf(tickets: readonly ReadinessTicket[]): string[] {
  const statusById        = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  const lowPriorityIsHeld = ticketsHoldingBackLowPriorityWork(tickets).length > 0;
  return tickets
    .filter((ticket) => ticket.status === 'open' && unsettledDependenciesOf(ticket.dependsOn ?? [], statusById).length === 0)
    .filter((ticket) => !lowPriorityIsHeld || ticketPriorityOf(ticket) !== 'low')
    .sort((a, b) => PRIORITY_RANK[ticketPriorityOf(a)] - PRIORITY_RANK[ticketPriorityOf(b)] || Number(a.id) - Number(b.id))
    .map((ticket) => ticket.id);
}

export const TicketDependencyUtil = {
  unsettledDependenciesOf,
  dependencyLoopFrom,
  ticketsHoldingBackLowPriorityWork,
  readyTicketIdsOf,
} as const;
