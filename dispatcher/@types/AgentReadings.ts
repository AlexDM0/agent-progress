/** What each agent's reply reads as once `WorkflowInputUtil` has mapped it in. */
import type { TicketPriority }                        from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { AgentModelAndEffort, ReadyTicketEntry } from './DispatchSettings.ts';

export interface StatusReading {
  limit:                 number;
  agentsInFlight:        number;
  readyTicketIds:        string[];
  readyTickets:          ReadyTicketEntry[];
  dispatcherIsStopped:   boolean;
  inProgressTicketIds:   string[] | 'unlisted';
  inProgressReviewOfIds: string[] | 'unlisted';
  heldTicketIds:         string[] | 'unlisted';
}

export interface ReviewWaitingTicket {
  id:                  string;
  agentModelAndEffort: AgentModelAndEffort;
}

/** Only a paused build whose worktree exists is read. */
export interface PausedBuild {
  id:                  string;
  note:                string;
  priority:            TicketPriority;
  agentModelAndEffort: AgentModelAndEffort;
}

export interface SurveyReading {
  status:               StatusReading | 'unreadable';
  reviewWaitingTickets: ReviewWaitingTicket[] | 'unlisted';
  pausedBuilds:         PausedBuild[];
}

export interface ReviewFinding {
  class:   string;
  file:    string;
  summary: string;
}

/** Only `main-moved` is decided on; any other reason is the reviewer's text, echoed into the park reason. */
export type ReleaseRefusal = 'main-moved' | { statedReason: string };

export type AgentReading =
  | { kind: 'build'; outcome: 'in-review' | 'claim-refused' | 'failed'; detail: string; claimNote: string; status: StatusReading | 'unreadable' }
  | {
    kind:           'review';
    round:          number | 'unstated';
    verdict:        'released' | 'round-requested' | 'does-not-hold' | 'not-released';
    releaseRefusal: ReleaseRefusal;
    reworkedLines:  number;
    findings:       ReviewFinding[];
    filedTicketIds: string[];
    status:         StatusReading | 'unreadable';
  }
  | { kind: 'park'; status: StatusReading | 'unreadable' };
