import type { Decision }                                from '../../lib/tracker-model/@types/Decision.ts';
import type { Incident }                                from '../../lib/tracker-model/@types/Incident.ts';
import type { Job }                                     from '../../lib/tracker-model/@types/Job.ts';
import type { TaskStatus }                              from '../../lib/tracker-model/@types/Task.ts';
import type { AgentEffort, AgentModel, TicketPriority } from '../../lib/tracker-model/@types/Ticket.ts';

export interface InProgressIds {
  inProgressTicketIds:   string[];
  inProgressReviewOfIds: string[];
}

export interface ReviewWaitingTicketEntry {
  id:     string;
  model:  AgentModel;
  effort: AgentEffort;
}

export interface PausedBuildEntry {
  id:       string;
  note:     string;
  priority: TicketPriority;
  model:    AgentModel;
  effort:   AgentEffort;
}

export interface TicketRowEntry {
  id:     number;
  status: TaskStatus;
  note:   string;
}

export interface ReviewBarEntry {
  id:     number;
  status: TaskStatus;
  round?: number;
}

export interface TicketRowsEntry {
  id:         string;
  row:        TicketRowEntry | null;
  reviewBars: ReviewBarEntry[];
}

export interface StatusBoardWork {
  reviewWaitingTickets: ReviewWaitingTicketEntry[];
  pausedBuilds:         PausedBuildEntry[];
  ticketRows:           TicketRowsEntry[];
}

export interface StatusJobs {
  /** Every unsettled job, in launch order, as progress.json stores it; empty on a tracker that launched none. */
  jobs: readonly Readonly<Job>[];
}

export interface StatusDecisionsAndIncidents {
  /** Every open decision for the user, in opening order, as progress.json stores it; empty when none is open. */
  decisions: readonly Readonly<Decision>[];
  /** Every open incident for the runner's orchestrator, in opening order, as progress.json stores it; empty when none is open. */
  incidents: readonly Readonly<Incident>[];
}
