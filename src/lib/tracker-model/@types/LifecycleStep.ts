/**
 * What the lifecycle policy derives from the board and the runner's observations: each step a change `Board.advanceLifecycle` applies in
 * the hold, so a step lost to a crash is derived again on the next pass.
 */
import type { DecisionKind, DecisionQuestion }                              from './Decision.ts';
import type { IncidentDefaultCause, IncidentDeliveryTurn, IncidentOpening } from './Incident.ts';

export type ParkCause = 'failed-passes';

/** A decision code opens from the facts; its questions are worded by the caller, never by the policy. */
export interface DecisionDraft {
  kind:      DecisionKind;
  ticketIds: readonly string[];
  jobId:     string | null;
}

export interface DecisionWording {
  questions: readonly Readonly<DecisionQuestion>[];
  context:   string;
}

export type LifecycleStep =
  | { kind: 'launch-build'; ticketId: string; attempt: number; base: string }
  | { kind: 'launch-review'; ticketId: string; round: number; target: string }
  | { kind: 'resume-job'; jobId: string }
  // Past `JOB_RESUMES_BEFORE_FRESH` crash resumes, or a session that went down: ended `replaced`.
  | { kind: 'replace-job'; jobId: string }
  | { kind: 'boot-orchestrator' }
  | { kind: 'park'; ticketId: string; cause: ParkCause }
  | { kind: 'open-decision'; decision: DecisionDraft }
  | { kind: 'open-incident'; incident: IncidentOpening }
  | { kind: 'default-incident'; incidentId: string; cause: IncidentDefaultCause }
  | { kind: 'stop-dispatching'; cause: 'outage' };

/** What the runner saw outside the board, passed in as values so the policy reaches no git, process or file. */
export interface LifecycleObservations {
  mainLine:                     string;
  /** A group ticket's work goes to this prefix followed by its group's name. */
  groupTargetPrefix:            string;
  installVersionChanged:        boolean;
  /** The targets whose committed CLAUDE.md still holds the managed block. */
  targetsHoldingManagedBlock:   readonly string[];
  /** The tickets whose branch changed agent configuration. */
  ticketIdsTouchingAgentConfig: readonly string[];
  /** The orchestrator turns that closed, an incident delivered in one of them taking its default. */
  closedDeliveryTurns:          readonly IncidentDeliveryTurn[];
}
