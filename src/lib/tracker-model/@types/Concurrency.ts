import type { DispatcherState } from './ProgressFile.ts';

export interface Concurrency {
  limit:          number;
  /** The in-progress rows grouped by their `agent` key, each group counted once; one with no key, such as a review bar, is an agent of its own. */
  agentsInFlight: number;
  /** Never negative: a limit lowered below the agents already in flight leaves no slot, and takes none of them back. */
  freeSlots:      number;
}

export interface DispatchCapacity extends Concurrency {
  readyTicketIds:  string[];
  dispatcherState: DispatcherState;
  heldTicketIds:   string[];
}
