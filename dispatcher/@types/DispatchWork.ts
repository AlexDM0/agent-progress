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
  rereviewFirst:       boolean;
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

export type AgentSubject = DispatchWork | { kind: 'survey' } | { kind: 'ticket-settings' };

export type AgentLaunch =
  | { key: number; work: ParkWork }
  | { key: number; work: AgentWork; agentModelAndEffort: AgentModelAndEffort; pausedBuildWasFoundBySurvey: boolean };

export interface FinishedAgent {
  key:     number;
  work:    DispatchWork;
  reading: AgentReading | null;
}
