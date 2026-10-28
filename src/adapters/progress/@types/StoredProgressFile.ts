/**
 * The shape progress.json is stored in, declared field by field rather than derived from the model, so a model change breaks the mappers'
 * compile instead of silently changing the format.
 */
import type { DecisionAsker, DecisionKind } from '../../../lib/tracker-model/@types/Decision.ts';
import type { IncidentKind, IncidentMove }  from '../../../lib/tracker-model/@types/Incident.ts';
import type {
  InterruptionCause,
  JobKind,
  JobOutcome,
  JobRole,
  JobState,
  SlotPhase
}                                             from '../../../lib/tracker-model/@types/Job.ts';
import type { TaskStatus }                    from '../../../lib/tracker-model/@types/Task.ts';
import type { DispatcherState, ViewRange }    from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { CURRENT_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

export interface StoredTaskPhase {
  status: TaskStatus;
  at:     string;
}

export interface StoredTask {
  id:              number;
  name:            string;
  status:          TaskStatus;
  start:           string | null;
  end:             string | null;
  owner:           string;
  note:            string;
  ticket:          string | null;
  tokens:          number | null;
  reviewed?:       string;
  reviewRound?:    number;
  history?:        StoredTaskPhase[];
  agent?:          string;
  reviewOf?:       string;
  reviewBarRound?: number;
  checkCommand?:   string;
  mergeQueued?:    true;
}

export interface StoredJobEventCursor {
  instance: number;
  sequence: number;
}

export interface StoredMergeSlot {
  target:    string;
  targetTip: string;
  branchTip: string;
  phase:     SlotPhase;
}

export interface StoredJob {
  id:                 string;
  kind:               JobKind;
  role:               JobRole | null;
  ticketIds:          string[];
  parentJobId:        string | null;
  attempt:            number;
  target:             string | null;
  state:              JobState;
  interruption?:      InterruptionCause;
  hostInstance:       number;
  eventCursor:        StoredJobEventCursor;
  answeredRequestIds: string[];
  crashResumes:       number;
  slot?:              StoredMergeSlot;
  outcome?:           JobOutcome;
}

export interface StoredProgressFile {
  version:           typeof CURRENT_PROGRESS_FILE_VERSION;
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  nextTaskId:        number;
  concurrencyLimit?: number;
  dispatcherState?:  DispatcherState;
  dispatcherRunId?:  string;
  checkCommand?:     string;
  installCommand?:   string;
  nextDraftId?:      number;
  nextJobId?:        number;
  jobs?:             StoredJob[];
  nextDecisionId?:   number;
  decisions?:        StoredDecision[];
  nextIncidentId?:   number;
  incidents?:        StoredIncident[];
  tasks:             StoredTask[];
}

export interface StoredDecisionQuestionOption {
  label:       string;
  description: string;
}

export interface StoredDecisionQuestion {
  question:    string;
  header:      string;
  multiSelect: boolean;
  options:     StoredDecisionQuestionOption[];
}

export interface StoredDecision {
  id:        string;
  kind:      DecisionKind;
  ticketIds: string[];
  jobId:     string | null;
  askedBy:   DecisionAsker;
  requestId: string | null;
  questions: StoredDecisionQuestion[];
  context:   string;
  openedAt:  string;
}

export interface StoredIncidentDeliveryTurn {
  jobId:        string;
  chatSequence: number;
}

export interface StoredIncident {
  id:              string;
  kind:            IncidentKind;
  ticketIds:       string[];
  jobId:           string | null;
  facts:           Record<string, string>;
  defaultMove:     IncidentMove;
  deliveredInTurn: StoredIncidentDeliveryTurn | null;
  openedAt:        string;
}
