/**
 * The dependency model the Dependencies tab, the epic cards and the Kanban's wave order share: waves, Held, the pace path and Unlocks.
 * Which ticket is ready is the Board's, read from `PageBoard.readyTicketIds`; a wave says only what stands in front of a ticket.
 */

import { TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY } from '../../src/lib/tracker-model/constants/Statuses.ts';
import { TicketDefaultsUtil }                       from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type {
  CrossGroupLink,
  DependencyGraph,
  DependencyGraphItem,
  DependencyGraphReaders,
  DependencyGraphTicket,
  DependencyWave
} from '../@types/DependencyGraph.ts';

function byLowestId(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

function waveLabelOf(waveIndex: number): string {
  return waveIndex === 0 ? 'Now' : `Wave ${waveIndex + 1}`;
}

/** Every id reachable from `startId` through `nextIdsOf`, never `startId` itself, so a cycle neither loops nor holds a node on itself. */
function reachableFrom(startId: string, nextIdsOf: (nodeId: string) => readonly string[]): Set<string> {
  const reached = new Set<string>();
  const toVisit = [...nextIdsOf(startId)];
  while (toVisit.length > 0) {
    const nodeId = toVisit.pop() ?? startId;
    if (nodeId === startId || reached.has(nodeId)) continue;
    reached.add(nodeId);
    toVisit.push(...nextIdsOf(nodeId));
  }
  return reached;
}

/**
 * Each open node's wave and the open dependencies it was measured through. A dependency still being measured when it is reached again
 * closes a cycle, and that edge is cut.
 */
function wavesMeasured(openNodeIds: readonly string[], openDependenciesOf: (nodeId: string) => readonly string[]) {
  const waveOfNode                 = new Map<string, number>();
  const measuredDependenciesOfNode = new Map<string, readonly string[]>();
  const beingMeasured              = new Set<string>();

  const measure = (nodeId: string): number => {
    const knownWave = waveOfNode.get(nodeId);
    if (knownWave !== undefined) return knownWave;
    beingMeasured.add(nodeId);
    const measuredDependencies = openDependenciesOf(nodeId).filter((dependencyId) => !beingMeasured.has(dependencyId));
    const wave = measuredDependencies.reduce((deepest, dependencyId) => Math.max(deepest, 1 + measure(dependencyId)), 0);
    beingMeasured.delete(nodeId);
    waveOfNode.set(nodeId, wave);
    measuredDependenciesOfNode.set(nodeId, measuredDependencies);
    return wave;
  };

  for (const nodeId of openNodeIds) measure(nodeId);
  return { waveOfNode, measuredDependenciesOfNode };
}

const TICKET_READERS: DependencyGraphReaders<DependencyGraphTicket> = {
  settlesDependents: (ticket) => TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY.includes(ticket.status),
  primaryGroupKeyOf: (ticket) => ticket.memberOfEpics[0]?.key ?? null,
  entersWaves:       (ticket) => !(ticket.status === 'pending' && TicketDefaultsUtil.ticketPriorityOf(ticket) === 'low'),
};

/**
 * Tickets are read by their status, priority and primary epic, abandoned ones leaving the graph and pending low ones the waves; any other
 * item needs its readers.
 */
function dependencyGraphOf(tickets: readonly DependencyGraphTicket[], concurrencyLimit: number): DependencyGraph;
function dependencyGraphOf<Item extends DependencyGraphItem>(items: readonly Item[], concurrencyLimit: number, readers: DependencyGraphReaders<Item>): DependencyGraph;

function dependencyGraphOf<Item extends DependencyGraphItem>(items: readonly Item[], concurrencyLimit: number, readers?: DependencyGraphReaders<Item>): DependencyGraph {
  if (readers === undefined) {
    // The first overload is the only one without readers, so the items are tickets.
    const tickets = items as readonly DependencyGraphItem[] as readonly DependencyGraphTicket[];
    return graphOf(tickets.filter((ticket) => ticket.status !== 'abandoned'), concurrencyLimit, TICKET_READERS);
  }
  return graphOf(items, concurrencyLimit, readers);
}

function graphOf<Item extends DependencyGraphItem>(items: readonly Item[], concurrencyLimit: number, readers: DependencyGraphReaders<Item>): DependencyGraph {
  const nodeById  = new Map(items.map((item) => [item.id, item] as const));
  const nodeIds   = [...nodeById.keys()].sort(byLowestId);
  const isSettled = (nodeId: string): boolean => {
    const node = nodeById.get(nodeId);
    return node !== undefined && readers.settlesDependents(node);
  };
  const isOpen = (nodeId: string): boolean => nodeById.has(nodeId) && !isSettled(nodeId);
  const isInWaves = (nodeId: string): boolean => {
    const node = nodeById.get(nodeId);
    return node !== undefined && isOpen(nodeId) && (readers.entersWaves?.(node) ?? true);
  };

  const settledNodeIds = nodeIds.filter(isSettled);
  const openNodeIds    = nodeIds.filter(isInWaves);

  const knownDependenciesOf = (nodeId: string): string[] => (
    [...new Set(nodeById.get(nodeId)?.dependsOn ?? [])].filter((dependencyId) => nodeById.has(dependencyId)).sort(byLowestId)
  );
  const dependentsById = new Map<string, string[]>(nodeIds.map((nodeId) => [nodeId, []]));
  for (const nodeId of nodeIds) {
    for (const dependencyId of knownDependenciesOf(nodeId)) dependentsById.get(dependencyId)?.push(nodeId);
  }
  const dependentsOf       = (nodeId: string): readonly string[] => dependentsById.get(nodeId) ?? [];
  const openDependenciesOf = (nodeId: string): string[] => knownDependenciesOf(nodeId).filter(isOpen);

  const heldOfNode     = new Map(nodeIds.map((nodeId) => [nodeId, new Set([...reachableFrom(nodeId, dependentsOf)].filter(isInWaves))] as const));
  const upstreamOfNode = new Map(nodeIds.map((nodeId) => [nodeId, reachableFrom(nodeId, knownDependenciesOf)] as const));
  const heldCountOf    = (nodeId: string): number => heldOfNode.get(nodeId)?.size ?? 0;
  const byMostHeld     = (a: string, b: string): number => heldCountOf(b) - heldCountOf(a) || byLowestId(a, b);

  // Measured over every open node, so one left out of the waves still pushes its dependents past "Now".
  const { waveOfNode: measuredWaveOfNode, measuredDependenciesOfNode } = wavesMeasured(nodeIds.filter(isOpen), openDependenciesOf);
  const waveOfNode = new Map(openNodeIds.map((nodeId) => [nodeId, measuredWaveOfNode.get(nodeId) ?? 0] as const));
  const waveCount = openNodeIds.reduce((count, nodeId) => Math.max(count, (waveOfNode.get(nodeId) ?? 0) + 1), 0);
  const nodeIdsInWave = (waveIndex: number): string[] => openNodeIds.filter((nodeId) => waveOfNode.get(nodeId) === waveIndex);

  const pacePathNodeIds: string[] = [];
  let pacingNodeId = nodeIdsInWave(waveCount - 1).sort(byMostHeld)[0];
  while (pacingNodeId !== undefined) {
    pacePathNodeIds.unshift(pacingNodeId);
    const previousWave = (waveOfNode.get(pacingNodeId) ?? 0) - 1;
    pacingNodeId = (measuredDependenciesOfNode.get(pacingNodeId) ?? [])
      .filter((dependencyId) => waveOfNode.get(dependencyId) === previousWave)
      .sort(byMostHeld)[0];
  }

  const waves = Array.from({ length: waveCount }, (_wave, waveIndex): DependencyWave => {
    const waveNodeIds = nodeIdsInWave(waveIndex).sort((a, b) => (
      Number(pacePathNodeIds.includes(b)) - Number(pacePathNodeIds.includes(a)) || byMostHeld(a, b)
    ));
    return {
      index: waveIndex, label: waveLabelOf(waveIndex), isNarrow: waveNodeIds.length === 1, nodeIds: waveNodeIds
    };
  });

  const unlocksOfNode = new Map(nodeIds.map((nodeId) => {
    const upstream = upstreamOfNode.get(nodeId) ?? new Set<string>();
    const unlocked = dependentsOf(nodeId).filter((dependentId) => dependentId !== nodeId && isInWaves(dependentId) && openDependenciesOf(dependentId).every((dependencyId) => (
      dependencyId === nodeId || upstream.has(dependencyId)
    )));
    return [nodeId, unlocked] as const;
  }));

  const primaryGroupKeyOf = (nodeId: string): string | null => {
    const node = nodeById.get(nodeId);
    return node === undefined ? null : readers.primaryGroupKeyOf(node);
  };
  const crossGroupLinks = nodeIds.flatMap((dependentNodeId) => knownDependenciesOf(dependentNodeId).flatMap((dependencyNodeId): CrossGroupLink[] => {
    const dependentGroupKey  = primaryGroupKeyOf(dependentNodeId);
    const dependencyGroupKey = primaryGroupKeyOf(dependencyNodeId);
    if (dependentGroupKey === null || dependencyGroupKey === null || dependentGroupKey === dependencyGroupKey) return [];
    return [{
      dependentNodeId, dependentGroupKey, dependencyNodeId, dependencyGroupKey
    }];
  }));

  return {
    settledNodeIds,
    openNodeIds,
    waveOfNode,
    waves,
    heldOfNode,
    upstreamOfNode,
    pacePathNodeIds,
    unlocksOfNode,
    crossGroupLinks,
    boardSlots: concurrencyLimit,
  };
}

export const DependencyGraphUtil = { dependencyGraphOf, waveLabelOf } as const;
