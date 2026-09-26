/**
 * The progress.json shape written before log.jsonl, holding its own log and possibly the retired task words. It can be deleted once every
 * tracker has been rewritten by `agent-progress update`.
 */
import type { ViewRange, DispatcherState }         from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { TaskStatus }                         from '../../../lib/tracker-model/@types/Task.ts';
import type { RetiredTaskStatusWord }              from '../../../shared/legacy/utils/RetiredStatusWordUtil.ts';
import type { StoredTask, StoredTaskPhase }        from '../../progress/@types/StoredProgressFile.ts';
import type { EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../../progress/constants/ProgressFileVersions.ts';

export type StoredTaskStatusWord = TaskStatus | RetiredTaskStatusWord;

export interface StoredTaskPhaseVersionOne extends Omit<StoredTaskPhase, 'status'> {
  status: StoredTaskStatusWord;
}

export interface StoredTaskVersionOne extends Omit<StoredTask, 'status' | 'history'> {
  status:   StoredTaskStatusWord;
  history?: StoredTaskPhaseVersionOne[];
}

export interface StoredLogEntry {
  at:   string;
  text: string;
}

export interface StoredProgressFileVersionOne {
  version:           typeof EMBEDDED_LOG_PROGRESS_FILE_VERSION;
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  nextTaskId:        number;
  concurrencyLimit?: number;
  dispatcherState?:  DispatcherState;
  dispatcherRunId?:  string;
  tasks:             StoredTaskVersionOne[];
  log:               StoredLogEntry[];
}
