/** The run's log as semantic calls: the domain names what happened, and `DispatchWordingUtil` words each entry on the way out. */
import type {
  HeldEntry,
  HeldStep,
  ParkReason,
  PassFailure
} from './DispatchOutcome.ts';
import type { AgentSubject } from './DispatchWork.ts';

export interface DispatchLogger {
  agentFailed(subject: AgentSubject, errorMessage: string): void;
  statusShowsTheRunStopped(agentsInFlight: number): void;
  ticketHeld(ticketId: string, waitingFor: HeldStep): void;
  ticketUnheld(ticketId: string, waitingFor: HeldStep): void;
  ticketParked(ticketId: string, reason: ParkReason): void;
  freshAgentTakesOver(ticketId: string, failure: PassFailure): void;
  ticketSkipped(ticketId: string, claimRefusalDetail: string): void;
  parkingAgentReturnedNothing(ticketId: string): void;
  mainLineMovedUnderRelease(ticketId: string, nextRound: number): void;
  roundGranted(ticketId: string, nextRound: number, reworkedLines: number): void;
  agentsDiedInARow(deadAgents: number, agentsInFlight: number): void;
  ticketSettingsUnread(ticketIds: readonly string[]): void;
  surveyReturnedNothing(): void;
  surveyStatusUnreadable(): void;
  surveyLeftTheMainCheckoutUnread(): void;
  mainCheckoutIsDirty(dirtyFiles: readonly string[]): void;
  rowsLeftRunning(ticketIds: readonly string[]): void;
  ticketsLeftWaiting(ticketIds: readonly string[], runIsStopped: boolean): void;
  lowPriorityLeftForTriage(ticketIds: readonly string[]): void;
  heldAtEnd(entries: readonly HeldEntry[]): void;
  runDone(deliveredCount: number, parkedTicketIds: readonly string[], findingsFiledCount: number, agentsRun: number): void;
  groupTicketRefused(ticketId: string, groupName: string): void;
  groupBundleUnread(groupName: string): void;
  ticketIntegrated(ticketId: string, groupName: string): void;
  releaseReviewLeft(ticketId: string): void;
}

export type DispatchLogEntry =
  | { kind: 'agent-failed'; subject: AgentSubject; errorMessage: string }
  | { kind: 'status-shows-the-run-stopped'; agentsInFlight: number }
  | { kind: 'ticket-held'; ticketId: string; waitingFor: HeldStep }
  | { kind: 'ticket-unheld'; ticketId: string; waitingFor: HeldStep }
  | { kind: 'ticket-parked'; ticketId: string; reason: ParkReason }
  | { kind: 'fresh-agent-takes-over'; ticketId: string; failure: PassFailure }
  | { kind: 'ticket-skipped'; ticketId: string; claimRefusalDetail: string }
  | { kind: 'parking-agent-returned-nothing'; ticketId: string }
  | { kind: 'main-line-moved-under-release'; ticketId: string; nextRound: number }
  | { kind: 'round-granted'; ticketId: string; nextRound: number; reworkedLines: number }
  | { kind: 'agents-died-in-a-row'; deadAgents: number; agentsInFlight: number }
  | { kind: 'ticket-settings-unread'; ticketIds: readonly string[] }
  | { kind: 'survey-returned-nothing' }
  | { kind: 'survey-status-unreadable' }
  | { kind: 'survey-left-the-main-checkout-unread' }
  | { kind: 'main-checkout-is-dirty'; dirtyFiles: readonly string[] }
  | { kind: 'rows-left-running'; ticketIds: readonly string[] }
  | { kind: 'tickets-left-waiting'; ticketIds: readonly string[]; runIsStopped: boolean }
  | { kind: 'low-priority-left-for-triage'; ticketIds: readonly string[] }
  | { kind: 'held-at-end'; entries: readonly HeldEntry[] }
  | { kind: 'run-done'; deliveredCount: number; parkedTicketIds: readonly string[]; findingsFiledCount: number; agentsRun: number }
  | { kind: 'group-ticket-refused'; ticketId: string; groupName: string }
  | { kind: 'group-bundle-unread'; groupName: string }
  | { kind: 'ticket-integrated'; ticketId: string; groupName: string }
  | { kind: 'release-review-left'; ticketId: string };
