import type { Task } from './Task.ts';

/** `relative` forms are stored raw (`"-2h"`, `"start"`, `"now"`) and resolved against an explicit `now` at layout time. */
export type ViewRange =
  | { kind: 'auto' }
  | { kind: 'absolute'; from: string; to: string; tickMinutes: number | null }
  | { kind: 'relative'; from: string; to: string; tickMinutes: number | null };

/** `finished` ended by itself and is relaunched when a ticket is ready; `stopped`, never started or ended by the user, waits for the user's go. */
export type DispatcherState = 'running' | 'finished' | 'stopped';

export interface ProgressFile {
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  /** Never wound back, not by a row removal and not by a clearing, so an id is never handed out twice. */
  nextTaskId:        number;
  /** How many agents may be in flight at once; absent on a tracker that never set one, which reads as the default. */
  concurrencyLimit?: number;
  /** Where the user left the dispatcher; absent on a tracker that never set one, which reads as `stopped`. */
  dispatcherState?:  DispatcherState;
  /** The Workflow run a `running` dispatcher is, stored so a killed run can be resumed after a compaction; absent in every other state. */
  dispatcherRunId?:  string;
  tasks:             Task[];
}
