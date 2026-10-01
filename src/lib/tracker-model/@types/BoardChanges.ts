/** What the Board's changes take and give back. Every change that logs returns the records it logged, in order. */
import type { Concurrency }                     from './Concurrency.ts';
import type { Epic }                            from './Epic.ts';
import type { LogRecord }                       from './LogRecord.ts';
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
}

export interface TicketRelease {
  branch: string;
  commit: string;
}

export interface Logged {
  logged: readonly LogRecord[];
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

export interface TrackerCleared extends Logged {
  removedTaskCount:     number;
  survivingTicketCount: number;
}
