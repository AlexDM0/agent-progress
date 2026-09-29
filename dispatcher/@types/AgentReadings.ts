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
  status:                 StatusReading | 'unreadable';
  reviewWaitingTickets:   ReviewWaitingTicket[] | 'unlisted';
  pausedBuilds:           PausedBuild[];
  /** The main checkout's uncommitted tracked files, where a release a builder's branch reaches would be refused over one it also changes. */
  dirtyMainCheckoutFiles: string[] | 'unlisted';
}

export interface ReviewFinding {
  class:   string;
  file:    string;
  summary: string;
}

export type BuilderOutcome = 'in-review' | 'claim-refused' | 'failed';

/** A group reviewer answers `integrated` where a whole-board one answers `released`, and never the latter. */
export type ReviewerVerdict = 'released' | 'integrated' | 'round-requested' | 'does-not-hold' | 'not-released';

/** What placing a ticket of a group in its release bundle reads of it. */
export interface ReleaseBundleTicket {
  id:            string;
  status:        string;
  dependsOn:     string[];
  releasesGroup: boolean;
}

/** One ticket of the group as the group survey copied it from the board. */
export interface GroupTicketReading extends ReleaseBundleTicket {
  agentModelAndEffort: AgentModelAndEffort;
  rowNote:             string;
  worktreeExists:      boolean;
  openReviewBar:       boolean;
}

/** A ticket of a looked-up ticket's group, as the settings lookup copied it from the board. */
export interface LookedUpGroupTicket extends ReleaseBundleTicket {
  groupName: string;
}

/** What `ticket show --json` said of each looked-up ticket, and the tickets of every group they name. */
export interface TicketSettingsLookup {
  tickets:      ReadyTicketEntry[];
  groupTickets: LookedUpGroupTicket[] | 'unlisted';
}

export interface GroupSurveyReading {
  status:  StatusReading | 'unreadable';
  tickets: GroupTicketReading[] | 'unlisted';
}

/** Only `main-moved` is decided on; any other reason is the reviewer's text, echoed into the park reason with the files that blocked the merge. */
export type ReleaseRefusal = 'main-moved' | { statedReason: string; blockingFiles: string[] };

export type AgentReading =
  | { kind: 'build'; outcome: BuilderOutcome; detail: string; claimNote: string; status: StatusReading | 'unreadable' }
  | {
    kind:           'review';
    round:          number | 'unstated';
    verdict:        ReviewerVerdict;
    releaseRefusal: ReleaseRefusal;
    reworkedLines:  number;
    findings:       ReviewFinding[];
    filedTicketIds: string[];
    status:         StatusReading | 'unreadable';
  }
  | { kind: 'park'; status: StatusReading | 'unreadable' };
