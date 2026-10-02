/** The dependency model the Dependencies tab, the epic cards and the Kanban's wave order share: waves, Held, the pace path and Unlocks. */

import { TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY } from '../../src/lib/tracker-model/constants/Statuses.ts';
import type {
  CrossEpicLink,
  DependencyGraph,
  DependencyGraphTicket,
  DependencyWave
} from '../@types/DependencyGraph.ts';

function byLowestId(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

function waveLabelOf(waveIndex: number): string {
  return waveIndex === 0 ? 'Now' : `Wave ${waveIndex + 1}`;
}

/** Every id reachable from `startId` through `nextIdsOf`, never `startId` itself, so a cycle neither loops nor holds a ticket on itself. */
function reachableFrom(startId: string, nextIdsOf: (ticketId: string) => readonly string[]): Set<string> {
  const reached = new Set<string>();
  const toVisit = [...nextIdsOf(startId)];
  while (toVisit.length > 0) {
    const ticketId = toVisit.pop() ?? startId;
    if (ticketId === startId || reached.has(ticketId)) continue;
    reached.add(ticketId);
    toVisit.push(...nextIdsOf(ticketId));
  }
  return reached;
}

/**
 * Each open ticket's wave and the open dependencies it was measured through. A dependency still being measured when it is reached again
 * closes a cycle, and that edge is cut.
 */
function wavesMeasured(openTicketIds: readonly string[], openDependenciesOf: (ticketId: string) => readonly string[]) {
  const waveOfTicket                = new Map<string, number>();
  const measuredDependenciesOfTicket = new Map<string, readonly string[]>();
  const beingMeasured               = new Set<string>();

  const measure = (ticketId: string): number => {
    const knownWave = waveOfTicket.get(ticketId);
    if (knownWave !== undefined) return knownWave;
    beingMeasured.add(ticketId);
    const measuredDependencies = openDependenciesOf(ticketId).filter((dependencyId) => !beingMeasured.has(dependencyId));
    const wave = measuredDependencies.reduce((deepest, dependencyId) => Math.max(deepest, 1 + measure(dependencyId)), 0);
    beingMeasured.delete(ticketId);
    waveOfTicket.set(ticketId, wave);
    measuredDependenciesOfTicket.set(ticketId, measuredDependencies);
    return wave;
  };

  for (const ticketId of openTicketIds) measure(ticketId);
  return { waveOfTicket, measuredDependenciesOfTicket };
}

function dependencyGraphOf(tickets: readonly DependencyGraphTicket[], concurrencyLimit: number): DependencyGraph {
  const ticketById = new Map(tickets.filter((ticket) => ticket.status !== 'abandoned').map((ticket) => [ticket.id, ticket] as const));
  const ticketIds  = [...ticketById.keys()].sort(byLowestId);
  const isSettled  = (ticketId: string): boolean => {
    const ticket = ticketById.get(ticketId);
    return ticket !== undefined && TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY.includes(ticket.status);
  };
  const isOpen = (ticketId: string): boolean => ticketById.has(ticketId) && !isSettled(ticketId);

  const settledTicketIds = ticketIds.filter(isSettled);
  const openTicketIds    = ticketIds.filter(isOpen);

  const knownDependenciesOf = (ticketId: string): string[] => (
    [...new Set(ticketById.get(ticketId)?.dependsOn ?? [])].filter((dependencyId) => ticketById.has(dependencyId)).sort(byLowestId)
  );
  const dependentsById = new Map<string, string[]>(ticketIds.map((ticketId) => [ticketId, []]));
  for (const ticketId of ticketIds) {
    for (const dependencyId of knownDependenciesOf(ticketId)) dependentsById.get(dependencyId)?.push(ticketId);
  }
  const dependentsOf        = (ticketId: string): readonly string[] => dependentsById.get(ticketId) ?? [];
  const openDependenciesOf  = (ticketId: string): string[] => knownDependenciesOf(ticketId).filter(isOpen);

  const heldOfTicket     = new Map(ticketIds.map((ticketId) => [ticketId, new Set([...reachableFrom(ticketId, dependentsOf)].filter(isOpen))] as const));
  const upstreamOfTicket = new Map(ticketIds.map((ticketId) => [ticketId, reachableFrom(ticketId, knownDependenciesOf)] as const));
  const heldCountOf      = (ticketId: string): number => heldOfTicket.get(ticketId)?.size ?? 0;
  const byMostHeld       = (a: string, b: string): number => heldCountOf(b) - heldCountOf(a) || byLowestId(a, b);

  const { waveOfTicket, measuredDependenciesOfTicket } = wavesMeasured(openTicketIds, openDependenciesOf);
  const waveCount = openTicketIds.reduce((count, ticketId) => Math.max(count, (waveOfTicket.get(ticketId) ?? 0) + 1), 0);
  const ticketIdsInWave = (waveIndex: number): string[] => openTicketIds.filter((ticketId) => waveOfTicket.get(ticketId) === waveIndex);

  const pacePathTicketIds: string[] = [];
  let pacingTicketId = ticketIdsInWave(waveCount - 1).sort(byMostHeld)[0];
  while (pacingTicketId !== undefined) {
    pacePathTicketIds.unshift(pacingTicketId);
    const previousWave = (waveOfTicket.get(pacingTicketId) ?? 0) - 1;
    pacingTicketId = (measuredDependenciesOfTicket.get(pacingTicketId) ?? [])
      .filter((dependencyId) => waveOfTicket.get(dependencyId) === previousWave)
      .sort(byMostHeld)[0];
  }

  const waves = Array.from({ length: waveCount }, (_, waveIndex): DependencyWave => {
    const waveTicketIds = ticketIdsInWave(waveIndex).sort((a, b) => (
      Number(pacePathTicketIds.includes(b)) - Number(pacePathTicketIds.includes(a)) || byMostHeld(a, b)
    ));
    return {
      index: waveIndex, label: waveLabelOf(waveIndex), isNarrow: waveTicketIds.length === 1, ticketIds: waveTicketIds
    };
  });

  const readyTicketIds = openTicketIds.filter((ticketId) => ticketById.get(ticketId)?.status === 'pending' && waveOfTicket.get(ticketId) === 0);

  const unlocksOfTicket = new Map(ticketIds.map((ticketId) => {
    const upstream = upstreamOfTicket.get(ticketId) ?? new Set<string>();
    const unlocked = dependentsOf(ticketId).filter((dependentId) => dependentId !== ticketId && isOpen(dependentId) && openDependenciesOf(dependentId).every((dependencyId) => (
      dependencyId === ticketId || upstream.has(dependencyId)
    )));
    return [ticketId, unlocked] as const;
  }));

  const primaryEpicKeyOf = (ticketId: string): string | null => ticketById.get(ticketId)?.memberOfEpics[0]?.key ?? null;
  const crossEpicLinks = ticketIds.flatMap((dependentTicketId) => knownDependenciesOf(dependentTicketId).flatMap((dependencyTicketId): CrossEpicLink[] => {
    const dependentEpicKey  = primaryEpicKeyOf(dependentTicketId);
    const dependencyEpicKey = primaryEpicKeyOf(dependencyTicketId);
    if (dependentEpicKey === null || dependencyEpicKey === null || dependentEpicKey === dependencyEpicKey) return [];
    return [{
      dependentTicketId, dependentEpicKey, dependencyTicketId, dependencyEpicKey
    }];
  }));

  return {
    settledTicketIds,
    openTicketIds,
    waveOfTicket,
    waves,
    readyTicketIds,
    heldOfTicket,
    upstreamOfTicket,
    pacePathTicketIds,
    unlocksOfTicket,
    crossEpicLinks,
    boardSlots: concurrencyLimit,
  };
}

export const DependencyGraphUtil = { dependencyGraphOf, waveLabelOf } as const;
