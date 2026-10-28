/** Why a pass failed, a round was refused or a ticket was parked, as reason codes, and what a run ends with. */
import type { RoundRefusal } from '../../src/lib/tracker-model/@types/ReviewRound.ts';

export type PassFailure =
  | { cause: 'builder-returned-nothing' }
  | { cause: 'own-claim-refused'; detail: string }
  | { cause: 'builder-stopped-short'; detail: string }
  | { cause: 'reviewer-returned-nothing' }
  | { cause: 'review-does-not-hold' };

export type ParkReason =
  | { cause: 'second-failed-pass'; failure: PassFailure }
  | { cause: 'release-refused'; statedReason: string; blockingFiles: readonly string[] }
  | { cause: 'main-line-moved'; releases: number }
  | { cause: 'round-refused'; refusal: RoundRefusal }
  | { cause: 'claim-refused'; detail: string }
  | { cause: 'released-out-of-turn'; releaseTicketId: string };

export interface ParkedTicket {
  ticketId: string;
  reason:   ParkReason;
}

/** What a held ticket waits on before its next agent starts. */
export type HeldStep = 'build' | 'review';

export interface HeldEntry {
  ticketId:   string;
  waitingFor: HeldStep;
}

export interface DispatchOutcome {
  delivered:               string[];
  parked:                  ParkedTicket[];
  findingsFiled:           string[];
  agentsRun:               number;
  runWasStoppedByBoard:    boolean;
  runWasStoppedByFailures: boolean;
  lowPriorityWaiting:      string[];
  held:                    HeldEntry[];
  pausedBuilds:            string[];
  reviewsLeft:             string[];
  dirtyMainCheckoutFiles:  string[];
  groupOutcome?:           GroupOutcome;
}

/** What only a group run ends with. */
export interface GroupOutcome {
  groupName:            string;
  integrated:           string[];
  waitingOnPredecessor: string[];
  bundleIsUnread:       boolean;
}

/** What the Workflow run returns, keys in the order the frozen trace table pins, each conditional key present only when it says something. */
export interface DispatchSummary {
  delivered:               string[];
  parked:                  { id: string; reason: string }[];
  findingsFiled:           string[];
  agentsRun:               number;
  stoppedByBoard?:         true;
  stoppedByFailures?:      true;
  lowPriorityWaiting?:     string[];
  held?:                   { id: string; waitingFor: HeldStep }[];
  pausedBuilds?:           string[];
  reviewsLeft?:            string[];
  dirtyMainCheckoutFiles?: string[];
  group?:                  string;
  integrated?:             string[];
  waitingOnPredecessor?:   string[];
  bundleUnread?:           true;
}
