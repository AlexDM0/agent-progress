/**
 * The shapes progress.json is stored in, declared field by field rather than derived from the model, so a model change breaks the mappers'
 * compile instead of silently changing the format. A stored task is typed by the status words it may hold: the retired ones until migrated.
 */
import type { DispatcherState, ViewRange }                                        from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { TaskStatus }                                                        from '../../../lib/tracker-model/@types/Task.ts';
import type { RetiredTaskStatusWord }                                             from '../../../shared/legacy/utils/RetiredStatusWordUtil.ts';
import type { CURRENT_PROGRESS_FILE_VERSION, EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

export type StoredTaskStatusWord = TaskStatus | RetiredTaskStatusWord;

export interface StoredTaskPhase<StatusWord extends StoredTaskStatusWord = StoredTaskStatusWord> {
  status: StatusWord;
  at:     string;
}

export interface StoredTask<StatusWord extends StoredTaskStatusWord = StoredTaskStatusWord> {
  id:              number;
  name:            string;
  status:          StatusWord;
  start:           string | null;
  end:             string | null;
  owner:           string;
  note:            string;
  ticket:          string | null;
  tokens:          number | null;
  reviewed?:       string;
  reviewRound?:    number;
  history?:        StoredTaskPhase<StatusWord>[];
  agent?:          string;
  reviewOf?:       string;
  reviewBarRound?: number;
}

export interface StoredLogEntry {
  at:   string;
  text: string;
}

export interface StoredProgressFileVersionOne<StatusWord extends StoredTaskStatusWord = StoredTaskStatusWord> {
  version:           typeof EMBEDDED_LOG_PROGRESS_FILE_VERSION;
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  nextTaskId:        number;
  concurrencyLimit?: number;
  dispatcherState?:  DispatcherState;
  dispatcherRunId?:  string;
  tasks:             StoredTask<StatusWord>[];
  log:               StoredLogEntry[];
}

export interface StoredProgressFileVersionTwo<StatusWord extends StoredTaskStatusWord = StoredTaskStatusWord> {
  version:           typeof CURRENT_PROGRESS_FILE_VERSION;
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  nextTaskId:        number;
  concurrencyLimit?: number;
  dispatcherState?:  DispatcherState;
  dispatcherRunId?:  string;
  tasks:             StoredTask<StatusWord>[];
}

export type StoredProgressFile<StatusWord extends StoredTaskStatusWord = StoredTaskStatusWord> =
  | StoredProgressFileVersionOne<StatusWord>
  | StoredProgressFileVersionTwo<StatusWord>;
