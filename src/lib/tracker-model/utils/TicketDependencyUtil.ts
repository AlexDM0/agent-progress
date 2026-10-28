/** Which tickets another ticket still waits on, which are ready to claim, and whether a new dependency list would close a loop. */
import type { TicketPriority, TicketStatus }                                             from '../@types/Ticket.ts';
import { TICKET_STATUSES_THAT_CLOSE_A_TICKET, TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY } from '../constants/Statuses.ts';
import { TicketDefaultsUtil }                                                            from './TicketDefaultsUtil.ts';

/** A dependency that is missing from `statusById` still counts as unsettled: a ticket nobody can see is not finished work. */
function unsettledDependenciesOf(dependsOn: readonly string[], statusById: ReadonlyMap<string, TicketStatus>): string[] {
  return dependsOn.filter((dependencyId) => {
    const status = statusById.get(dependencyId);
    return status === undefined || !TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY.includes(status);
  });
}

/** Empty for a closed ticket, whose list is history: showing it as waiting would suggest work that is not coming. */
function waitingOnOf(ticket: { status: TicketStatus; dependsOn?: readonly string[] }, statusById: ReadonlyMap<string, TicketStatus>): string[] {
  if (TICKET_STATUSES_THAT_CLOSE_A_TICKET.includes(ticket.status)) return [];
  return unsettledDependenciesOf(ticket.dependsOn ?? [], statusById);
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

const PRIORITY_RANK: Record<TicketPriority, number> = { high: 0, normal: 1, low: 2 };

/** A ticket with no readiness position, readied before positions were logged or behind a clearing, ranks before every positioned one. */
const UNRECORDED_READINESS_POSITION = -1;

/**
 * The pending tickets whose every dependency is reviewed or delivered, in the order to take them: by priority, then by readiness (the log
 * position that last put the ticket in the queue), then lowest id first. Priority only orders: a low ticket is as ready as any other.
 */
function readyTicketIdsOf(tickets: readonly ReadinessTicket[], readinessPositionByTicketId: ReadonlyMap<string, number> = new Map()): string[] {
  const statusById          = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  const readinessPositionOf = (ticket: ReadinessTicket): number => readinessPositionByTicketId.get(ticket.id) ?? UNRECORDED_READINESS_POSITION;
  return tickets
    .filter((ticket) => ticket.status === 'pending' && unsettledDependenciesOf(ticket.dependsOn ?? [], statusById).length === 0)
    .sort((a, b) => (
      PRIORITY_RANK[TicketDefaultsUtil.ticketPriorityOf(a)] - PRIORITY_RANK[TicketDefaultsUtil.ticketPriorityOf(b)]
      || readinessPositionOf(a) - readinessPositionOf(b)
      || Number(a.id) - Number(b.id)
    ))
    .map((ticket) => ticket.id);
}

export const TicketDependencyUtil = {
  unsettledDependenciesOf,
  waitingOnOf,
  dependencyLoopFrom,
  readyTicketIdsOf,
} as const;
