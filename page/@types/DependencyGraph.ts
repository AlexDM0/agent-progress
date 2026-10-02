import type { TicketStatus } from '../../src/lib/tracker-model/@types/Ticket.ts';

/** What the dependency views need of a ticket; a `BoardTicket` is one. */
export interface DependencyGraphTicket {
  id:            string;
  status:        TicketStatus;
  dependsOn?:    readonly string[];
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
  /** Lowest id first. */
  readyTicketIds:    readonly string[];
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
