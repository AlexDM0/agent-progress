/** The work a run hands its agents, and what an agent's launch and its finish carry. */
import type { AgentReading }        from './AgentReadings.ts';
import type { ParkReason }          from './DispatchOutcome.ts';
import type { AgentModelAndEffort } from './DispatchSettings.ts';

export type PreviousPass = 'builder' | 'review' | 'paused' | null;

export interface BuildWork {
  kind:         'build';
  ticketId:     string;
  previousPass: PreviousPass;
  rowIsPaused?: true;
}

export interface ReviewWork {
  kind:                'review';
  ticketId:            string;
  round:               number;
  rereviewRunsFirst:   boolean;
  earlierReviewerDied: boolean;
  barIsHandedOn?:      true;
  rowIsPaused?:        true;
}

export type RowRelease = { cause: 'parked'; parkReason: ParkReason } | { cause: 'held' } | { cause: 'left-for-the-go' };

export interface ParkWork {
  kind:     'park';
  ticketId: string;
  release:  RowRelease;
}

export type AgentWork = BuildWork | ReviewWork;

export type DispatchWork = AgentWork | ParkWork;

export type AgentSubject = DispatchWork | { kind: 'survey' } | { kind: 'ticket-settings' } | { kind: 'group-survey' };

/**
 * Where a group run's ticket sits in its group, which its agent's prompt states: `dependencyIds` are its dependencies inside the bundle, and
 * `pipelinedBehindId` the one of them still in review that its builder forks off, null when it forks off the group branch.
 */
export interface GroupPlacement {
  groupName:         string;
  orderedTicketIds:  readonly string[];
  releaseTicketId:   string;
  dependencyIds:     readonly string[];
  pipelinedBehindId: string | null;
}

/** `pass` is the ticket's pass in this run, one more than its failed passes so far, which keeps a rebuild's agent call apart from the build before it. */
export type AgentLaunch =
  | { key: number; work: ParkWork }
  | { key: number; work: AgentWork; pass: number; agentModelAndEffort: AgentModelAndEffort; pausedBuildWasFoundBySurvey: boolean; groupPlacement?: GroupPlacement };

export interface FinishedAgent {
  key:     number;
  work:    DispatchWork;
  reading: AgentReading | null;
}
