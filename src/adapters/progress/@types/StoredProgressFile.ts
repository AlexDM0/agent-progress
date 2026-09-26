/**
 * The shape progress.json is stored in, declared field by field rather than derived from the model, so a model change breaks the mappers'
 * compile instead of silently changing the format.
 */
import type { DispatcherState, ViewRange }    from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { TaskStatus }                    from '../../../lib/tracker-model/@types/Task.ts';
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
  tasks:             StoredTask[];
}
