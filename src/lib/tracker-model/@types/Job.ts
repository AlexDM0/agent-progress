/**
 * A unit of the runner's agent work, stored in progress.json while it is unsettled so a restart reads every job from disk. Only what the
 * runner decided is stored: a host's process identity lives in the job's own folder, never on the board.
 */

/** `onboarder` reads the repository and proposes its pipeline, or advises on the one it has; it never touches a ticket. */
export type JobKind = 'build' | 'review' | 'merge' | 'merge-agent' | 'refresh' | 'orchestrator' | 'product-owner' | 'onboarder';

export type JobRole = 'builder' | 'reviewer' | 'merge-fix' | 'resolver' | 'resolution-review' | 'orchestrator' | 'product-owner' | 'onboarder';

export type JobState =
  | 'launching'
  | 'preparing'
  | 'running'
  | 'waiting-for-answer'
  | 'interrupted'
  | 'awaiting-answer'
  | 'verifying'
  | 'gating'
  | 'merging'
  | 'landing'
  | 'stopping';

/** What the legality table is keyed by: every state a job can be moved into, and `ended`, which takes it off the board. */
export type JobMoveTarget = JobState | 'ended';

export type JobOutcome =
  | 'built'
  | 'reviewed'
  | 'round-granted'
  | 'does-not-hold'
  | 'resolved'
  | 'cannot-resolve'
  | 'landed'
  | 'integrated'
  | 'refreshed'
  | 'wound-down'
  | 'failed'
  | 'blocked'
  | 'replaced'
  | 'stopped'
  | 'closed';

/**
 * `host-lost` and `agent-crashed` are the crashes a resume counts; the others never count. `handoff-red` is a handoff whose gate or Customs
 * check went red: the same session is resumed to fix it, counted on its own bound.
 */
export type InterruptionCause = 'host-lost' | 'agent-crashed' | 'reboot' | 'answer-delivery' | 'usage-limit' | 'handoff-red';

export type SlotPhase = 'merge-in' | 'resolving' | 'reviewing-resolution' | 'gating' | 'fixing' | 'landing';

export interface MergeSlot {
  target:    string;
  targetTip: string;
  branchTip: string;
  phase:     SlotPhase;
}

/** What User asked of a live job: `stop` and `wind-down` hold its ticket, `fresh` stops it for a fresh agent on the same worktree. */
export type JobStopMode = 'stop' | 'wind-down' | 'fresh';

/**
 * A product-owner job's intake: User's request, the draft sets it proposed when it closed intake, and, for a fresh session taking over
 * one replaced past the bound, the answers its predecessor's questions got.
 */
export interface JobIntake {
  text:               string;
  proposedDraftSets?: string[][];
  carriedAnswers?:    Readonly<Record<string, string>>[];
}

/** The last host event the runner applied, written in the hold that applied it. */
export interface JobEventCursor {
  instance: number;
  sequence: number;
}

export interface Job {
  /** `J<n>`, from the stored `nextJobId`, never reused or gap-filled. */
  id:                 string;
  kind:               JobKind;
  /** `null` for a merge or refresh job, which runs no agent of its own. */
  role:               JobRole | null;
  ticketIds:          string[];
  /** A merge agent's merge or refresh job; `null` for every other job. */
  parentJobId:        string | null;
  /** From 1; a fresh agent after a failed pass or a `replaced` job is a new job one attempt on. */
  attempt:            number;
  /** The main line or `group-<name>` the job's work goes to; `null` for a session. */
  target:             string | null;
  state:              JobState;
  /** Why the job was last interrupted; absent on a job never interrupted. */
  interruption?:      InterruptionCause;
  /** The newest host instance spawned or to spawn, from 1. */
  hostInstance:       number;
  eventCursor:        JobEventCursor;
  /** The relayed question request ids already answered, kept until the job ends, so an answer is never delivered twice. */
  answeredRequestIds: string[];
  /** Resumes after a `host-lost` or `agent-crashed` interruption only. */
  crashResumes:       number;
  /** On the merge or refresh job holding its target's slot, while it holds it. */
  slot?:              MergeSlot;
  /** Set once User stopped, wound down or freshened the job; the runner sends its frames from it. */
  stopRequest?:       JobStopMode;
  /** On a product-owner job only. */
  intake?:            JobIntake;
  /** Set only on the record `job-ended` hands back: an ended job leaves the board in the same hold. */
  outcome?:           JobOutcome;
}

export interface JobLaunch {
  kind:        JobKind;
  role:        JobRole | null;
  ticketIds:   readonly string[];
  parentJobId: string | null;
  attempt:     number;
  target:      string | null;
  intake?:     JobIntake;
}

export interface JobEnding {
  outcome:            JobOutcome;
  /** What ended it, worded by the runner; absent when the outcome says it all. */
  cause?:             string;
  /** The commit the job's work ended on, when it made one. */
  commit?:            string;
  deniedPermissions?: readonly string[];
}

export type RunnerStopReason = 'stopped' | 'handed-over';

/** How a merge reached its target: `landed` fast-forwarded the main line, `integrated` a group branch. */
export type LandingKind = 'landed' | 'integrated';

/** `cannot-run` is a gate that never judged the tree (exit 126 or 127, or a signal), never a failed pass. */
export type GateOutcome = 'passed' | 'failed' | 'cannot-run';
