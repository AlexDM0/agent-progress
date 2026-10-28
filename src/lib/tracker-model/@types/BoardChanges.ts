/** What the Board's changes take and give back. Every change that logs returns the records it logged, in order. */
import type { Concurrency }                     from './Concurrency.ts';
import type { Decision, DecisionAnswer }        from './Decision.ts';
import type { Draft }                           from './Draft.ts';
import type { Epic }                            from './Epic.ts';
import type { Incident }                        from './Incident.ts';
import type { Job }                             from './Job.ts';
import type { LifecycleStep }                   from './LifecycleStep.ts';
import type { LogRecord, LogRecordFieldsOf }    from './LogRecord.ts';
import type { Task, TaskStatus }                from './Task.ts';
import type { AgentEffort, AgentModel, Ticket } from './Ticket.ts';
import type { DispatcherState }                 from './TrackerProgress.ts';

export interface AgentChoice {
  model?:  AgentModel;
  effort?: AgentEffort;
}

export interface AgentAssignment {
  owner?: string;
  note?:  string;
}

/** `afterTicketId` claims a pipelined successor while that predecessor of its release bundle is still in review. */
export interface TicketClaim extends AgentAssignment {
  afterTicketId?: string;
}

export interface ReviewBarRequest extends AgentAssignment {
  round: number;
}

export interface ReviewBarLink {
  ticketId: string;
  round:    number;
}

export interface TaskAddition extends AgentAssignment {
  name:         string;
  tokens?:      number;
  ticketId?:    string;
  reviewOf?:    ReviewBarLink;
  startsNow:    boolean;
  movesTheLink: boolean;
}

export interface TaskAnnotation extends AgentAssignment {
  tokens?: number;
}

export interface TaskCorrection {
  name?:   string;
  status?: TaskStatus;
}

/** A `review` share lands on the ticket's newest review bar, which its reviewer filed after the brief was written. */
export type TokenCredit =
  | { target: 'row'; taskId: number; tokens: number }
  | { target: 'ticket'; ticketId: string; tokens: number }
  | { target: 'review'; ticketId: string; tokens: number };

export type TokenCreditOutcome =
  | { verdict: 'credited'; taskId: number }
  | { verdict: 'unknown-row'; taskId: number }
  | { verdict: 'unknown-ticket'; ticketId: string }
  | { verdict: 'ticket-without-row'; ticketId: string }
  | { verdict: 'ticket-row-missing'; ticketId: string; taskId: number }
  | { verdict: 'ticket-without-review-bar'; ticketId: string };

export interface TicketMoveRequest {
  checksLegality: boolean;
  branch?:        string;
  commit?:        string;
  reason?:        string;
  tokens?:        number;
  /** Logged on a delivery recorded by hand, work the runner never merged or landed. */
  byHand?:        boolean;
}

export interface TicketRelease {
  branch: string;
  commit: string;
}

export interface Logged {
  logged: readonly LogRecord[];
}

/** What a review pass records beside the round, which the Board takes from the review bar it is recorded on. */
export type ReviewRecording = Omit<LogRecordFieldsOf<'review-recorded'>, 'round'>;

export interface ReviewRecorded extends Logged {
  taskId: number;
  round:  number;
}

export interface TicketChanged extends Logged {
  ticket: Readonly<Ticket>;
}

/** `droppedUnsettledTicketIds` are the dropped ones not yet reviewed or delivered: work the ticket may now start ahead of. */
export interface TicketDependenciesChanged extends TicketChanged {
  addedTicketIds:            readonly string[];
  droppedTicketIds:          readonly string[];
  droppedUnsettledTicketIds: readonly string[];
}

export interface EpicChanged extends Logged {
  epic: Readonly<Epic>;
}

/** `changed` is false for an edit that would write back what the epic already holds, which logs and writes nothing. */
export interface EpicEdited extends EpicChanged {
  changed: boolean;
}

/** A move between live states logs nothing, so `logged` is empty for it: a job's state lives in progress.json. */
export interface JobChanged extends Logged {
  job: Readonly<Job>;
}

/** The lifecycle steps one pass applied, in order, and everything they logged. */
export interface LifecycleAdvanced extends Logged {
  steps: readonly LifecycleStep[];
}

/** `decision` is `null` when the request it was opened for was already answered, and the open one, logging nothing, when it is open. */
export interface DecisionOpened extends Logged {
  decision: Readonly<Decision> | null;
}

export interface DecisionAnswered extends Logged {
  decision: Readonly<Decision>;
  answer:   DecisionAnswer;
}

export interface DecisionClosed extends Logged {
  decision: Readonly<Decision>;
}

/** As `DecisionOpened`: `null` for an answered request, the open incident for a request already asked. */
export interface IncidentOpened extends Logged {
  incident: Readonly<Incident> | null;
}

export interface IncidentClosed extends Logged {
  incident: Readonly<Incident>;
}

export interface IncidentEscalated extends Logged {
  incident: Readonly<Incident>;
  decision: Readonly<Decision>;
}

export interface DraftChanged extends Logged {
  draft: Readonly<Draft>;
}

/** `changed` is false for a claim the owner already holds or a release of an unclaimed draft, which logs and writes nothing. */
export interface DraftClaimChanged extends DraftChanged {
  changed: boolean;
}

export interface TicketEpicsChanged extends TicketChanged {
  addedEpicKeys:   readonly string[];
  droppedEpicKeys: readonly string[];
}

export interface TicketMoved extends TicketChanged {
  closedReviewBars: readonly Readonly<Task>[];
}

export interface ReviewBarStarted extends Logged {
  bar:        Readonly<Task>;
  closedBars: readonly Readonly<Task>[];
}

export interface TicketsClaimed extends Logged {
  tickets:     readonly Readonly<Ticket>[];
  concurrency: Concurrency;
}

export interface TicketsReadied extends Logged {
  tickets: readonly Readonly<Ticket>[];
}

export interface TicketsReleased extends Logged {
  tickets:          readonly Readonly<Ticket>[];
  closedReviewBars: readonly Readonly<Task>[];
}

export interface AgentStopRecorded extends Logged {
  outcomes: TokenCreditOutcome[];
}

export interface ConcurrencyLimitSet extends Logged {
  previousLimit: number;
  concurrency:   Concurrency;
}

export interface DispatcherStateSet extends Logged {
  previousState: DispatcherState;
}

export interface CheckCommandSet extends Logged {
  previousCheckCommand: string | null;
  restampedTicketIds:   readonly string[];
}

export interface InstallCommandSet extends Logged {
  previousInstallCommand: string | null;
}

export interface ChecksDefinitionFilesSet extends Logged {
  previousChecksDefinitionFiles: readonly string[] | null;
}

export interface GateKeyCommandSet extends Logged {
  previousGateKeyCommand: string | null;
}

export interface GateCachePathsSet extends Logged {
  previousGateCachePaths: readonly string[] | null;
}

export interface TrackerCleared extends Logged {
  removedTaskCount:     number;
  survivingTicketCount: number;
  removedEpicCount:     number;
}
