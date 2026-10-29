/** The fields of the Overseer's `BoardState` (`GET /api/state`, the `board` event) the shell reads; each view adds the fields it uses. */
export interface IdentifiedRecord {
  readonly id: string;
}

export type OverseerRuntimeState = 'serving' | 'held-by-install-change' | 'handing-over' | 'down';

export interface OverseerFactsDocument {
  readonly state:       OverseerRuntimeState;
  readonly paused:      boolean;
  readonly codeVersion: string;
}

export interface BoardStateDocument {
  readonly project:   string;
  readonly jobs:      readonly IdentifiedRecord[];
  readonly decisions: readonly IdentifiedRecord[];
  readonly incidents: readonly IdentifiedRecord[];
  readonly overseer:  OverseerFactsDocument;
  readonly usage:     unknown;
}

/** `GET /api/identity`: what the Bridge needs to key its preferences and to notice new code behind the same port. */
export interface OverseerIdentity {
  readonly trackerId:   string;
  readonly project:     string;
  readonly codeVersion: string;
}
