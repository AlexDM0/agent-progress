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

/** Where a group run's ticket sits in the group's pipeline, which its agent's prompt states. */
export interface GroupPlacement {
  groupName:        string;
  orderedTicketIds: readonly string[];
  releaseTicketId:  string;
  predecessorId:    string | null;
}

export type AgentLaunch =
  | { key: number; work: ParkWork }
  | { key: number; work: AgentWork; agentModelAndEffort: AgentModelAndEffort; pausedBuildWasFoundBySurvey: boolean; groupPlacement?: GroupPlacement };

export interface FinishedAgent {
  key:     number;
  work:    DispatchWork;
  reading: AgentReading | null;
}
