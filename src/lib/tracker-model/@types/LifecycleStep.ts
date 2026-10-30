/**
 * What the lifecycle policy derives from the board and the runner's observations: each step a change `Board.advanceLifecycle` applies in
 * the hold, so a step lost to a crash is derived again on the next pass.
 */
import type { DecisionKind, DecisionQuestion }                              from './Decision.ts';
import type { IncidentDefaultCause, IncidentDeliveryTurn, IncidentOpening } from './Incident.ts';

export type ParkCause = 'failed-passes' | 'red-resumes-spent';

/** A decision code opens from the facts; its questions are worded by the caller, never by the policy. */
export interface DecisionDraft {
  kind:              DecisionKind;
  ticketIds:         readonly string[];
  jobId:             string | null;
  /** Only on a `ready-drafts` decision: what its options are worded from. */
  readyDrafts?:      ReadyDraftsFacts;
  /** Only on a `pipeline-proposal` decision: the proposal with its twice-run record, which its options accept or decline. */
  pipelineProposal?: PipelineProposalFacts;
}

/** An onboarder's verified proposal as User sees it: each gate with what its two runs did, and the caching suggestions by kind and values. */
export interface PipelineProposalFacts {
  snapshotCommit:     string;
  prepare:            readonly { name: string; run: string }[];
  failedPrepareSteps: readonly (string | null)[];
  gates:              readonly { name: string; run: string; verdict: string; outcomes: readonly string[]; durationsMilliseconds: readonly number[] }[];
  review:             string | null;
  constitution:       readonly string[];
  agents:             Readonly<Record<string, readonly string[]>>;
  suggestions:        readonly { kind: string; values: readonly string[] }[];
}

export interface ReadyDraftFact {
  id:        string;
  title:     string;
  priority:  string;
  network:   readonly string[];
  /** `false` for a draft `ticket ready` would refuse: no numbered Acceptance or no Brief. */
  readiable: boolean;
}

/** A product owner's drafts and the sets it proposed, each set of readiable ids only; an option per set and one for none. */
export interface ReadyDraftsFacts {
  drafts:       readonly ReadyDraftFact[];
  proposedSets: readonly (readonly string[])[];
}

export interface DecisionWording {
  questions: readonly Readonly<DecisionQuestion>[];
  context:   string;
}

export type LifecycleStep =
  | { kind: 'launch-build'; ticketId: string; attempt: number; base: string }
  | { kind: 'launch-review'; ticketId: string; round: number; target: string }
  // Without a review phase, a ticket left in review and not yet queued: queued to land as a gated build is.
  | { kind: 'queue-merge'; ticketId: string; target: string }
  | { kind: 'resume-job'; jobId: string }
  // Past `JOB_RESUMES_BEFORE_FRESH` crash resumes, or a session that went down: ended `replaced`.
  | { kind: 'replace-job'; jobId: string }
  // A product owner replaced past the bound while its question is open waits for the answer with no process.
  | { kind: 'await-answer'; jobId: string }
  // A product owner past the bound whose questions are answered: a fresh session takes its drafts and the answers, never a resume.
  | { kind: 'refresh-intake'; jobId: string }
  | { kind: 'boot-orchestrator' }
  // With no pipeline, the one onboarder answering `checks-not-set`.
  | { kind: 'launch-onboarder' }
  // `jobId` names a job interrupted on a red handoff with its resumes spent, which ends `failed` as its ticket parks.
  | { kind: 'park'; ticketId: string; cause: ParkCause; jobId?: string }
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
  /** The orchestrator turns still open that reached their call budget: an incident delivered in one takes its default, cause `turn-budget`. */
  budgetSpentDeliveryTurns:     readonly IncidentDeliveryTurn[];
  /** The live orchestrator's session has reached a `result`, which ends a run of failed boots. */
  orchestratorHasAnswered:      boolean;
  /** A sweep asks for one more boot past the failed-boot bound; never set in the pass a boot failed. */
  orchestratorBootRetryDue:     boolean;
}
