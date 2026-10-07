import type { TicketStatus } from '../../src/lib/tracker-model/@types/Ticket.ts';

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
}

/** What the dependency views need of a ticket; a `BoardTicket` is one. */
export interface DependencyGraphTicket extends DependencyGraphItem {
  status:        TicketStatus;
  /** Primary epic first. */
  memberOfEpics: readonly { key: string }[];
}

export interface DependencyWave {
  /** 0 is the wave nothing open stands in front of. */
  index:     number;
  label:     string;
  /** Exactly one ticket: the bottleneck signal. */
  isNarrow:  boolean;
  /** Pace-path ticket first, then most held first, then lowest id first. */
  ticketIds: readonly string[];
}

/** A dependency edge whose two ends have different primary epics. */
export interface CrossEpicLink {
  dependentTicketId:  string;
  dependentEpicKey:   string;
  dependencyTicketId: string;
  dependencyEpicKey:  string;
}

export interface DependencyGraph {
  /** Lowest id first. */
  settledTicketIds:  readonly string[];
  /** Lowest id first. */
  openTicketIds:     readonly string[];
  /** Only open tickets have a wave. */
  waveOfTicket:      ReadonlyMap<string, number>;
  waves:             readonly DependencyWave[];
  /** The open tickets waiting on a ticket directly or further down the chain, for every ticket that is not abandoned. */
  heldOfTicket:      ReadonlyMap<string, ReadonlySet<string>>;
  /** Every ticket a ticket depends on directly or further up the chain, for every ticket that is not abandoned. */
  upstreamOfTicket:  ReadonlyMap<string, ReadonlySet<string>>;
  /** From the first wave to the last. */
  pacePathTicketIds: readonly string[];
  /** The direct dependents that can start the moment a ticket finishes, lowest id first. */
  unlocksOfTicket:   ReadonlyMap<string, readonly string[]>;
  crossEpicLinks:    readonly CrossEpicLink[];
  boardSlots:        number;
}
