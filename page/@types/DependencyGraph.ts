import type { TicketPriority, TicketStatus } from '../../src/lib/tracker-model/@types/Ticket.ts';

/** What the graph needs of any item it lays out. */
export interface DependencyGraphItem {
  id:         string;
  dependsOn?: readonly string[];
}

/** How the graph reads an item that is not a ticket. */
export interface DependencyGraphReaders<Item extends DependencyGraphItem> {
  /** A settled item no longer holds its dependents back. */
  settlesDependents: (item: Item) => boolean;
  /** Links between items of different primary groups become cross-group links. */
  primaryGroupKeyOf: (item: Item) => string | null;
  /** An open item left out of the waves is drawn nowhere, yet still holds its dependents back; every open item enters when absent. */
  entersWaves?:      (item: Item) => boolean;
}

/** What the dependency views need of a ticket; a `BoardTicket` is one. */
export interface DependencyGraphTicket extends DependencyGraphItem {
  status:        TicketStatus;
  priority?:     TicketPriority;
  /** Primary epic first. */
  memberOfEpics: readonly { key: string }[];
}

export interface DependencyWave {
  /** 0 is the wave nothing open stands in front of. */
  index:    number;
  label:    string;
  /** Exactly one node: the bottleneck signal. */
  isNarrow: boolean;
  /** Pace-path node first, then most held first, then lowest id first. */
  nodeIds:  readonly string[];
}

/** A dependency edge whose two ends have different primary groups. */
export interface CrossGroupLink {
  dependentNodeId:    string;
  dependentGroupKey:  string;
  dependencyNodeId:   string;
  dependencyGroupKey: string;
}

export interface DependencyGraph {
  /** Lowest id first. */
  settledNodeIds:  readonly string[];
  /** Lowest id first, only those entering the waves: a pending low-priority ticket is in neither list. */
  openNodeIds:     readonly string[];
  /** Only open nodes have a wave. */
  waveOfNode:      ReadonlyMap<string, number>;
  /** A wave can be empty, its nodes all waiting on one left out of the waves. */
  waves:           readonly DependencyWave[];
  /** The open nodes in the waves waiting on a node directly or further down the chain, for every node in the graph. */
  heldOfNode:      ReadonlyMap<string, ReadonlySet<string>>;
  /** Every node a node depends on directly or further up the chain, for every node in the graph. */
  upstreamOfNode:  ReadonlyMap<string, ReadonlySet<string>>;
  /** From the first wave to the last. */
  pacePathNodeIds: readonly string[];
  /** The direct dependents that can start the moment a node finishes, lowest id first. */
  unlocksOfNode:   ReadonlyMap<string, readonly string[]>;
  crossGroupLinks: readonly CrossGroupLink[];
  boardSlots:      number;
}
