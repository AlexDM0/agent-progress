import type { Decision } from './Decision.ts';
import type { Incident } from './Incident.ts';
import type { Job }      from './Job.ts';
import type { Task }     from './Task.ts';

/** `relative` forms are stored raw (`"-2h"`, `"start"`, `"now"`) and resolved against an explicit `now` at layout time. */
export type ViewRange =
  | { kind: 'auto' }
  | { kind: 'absolute'; from: string; to: string; tickMinutes: number | null }
  | { kind: 'relative'; from: string; to: string; tickMinutes: number | null };

/**
 * `finished` ended by itself; `stopped`, never started or ended by the user, waits for the user's go. A stored `finished` reads as `stopped`,
 * which fails closed: nothing starts before the user looks.
 */
export type DispatcherState = 'running' | 'finished' | 'stopped';

export interface TrackerProgress {
  trackerId:              string;
  project:                string;
  startedAt:              string;
  view:                   ViewRange;
  /** Never wound back, not by a row removal and not by a clearing, so an id is never handed out twice. */
  nextTaskId:             number;
  /** How many agents may be in flight at once; absent on a tracker that never set one, which reads as the default. */
  concurrencyLimit?:      number;
  /** Where the user left the dispatcher; absent on a tracker that never set one, which reads as `stopped`. */
  dispatcherState?:       DispatcherState;
  /** The Workflow run a `running` dispatcher is, stored so a killed run can be resumed after a compaction; absent in every other state. */
  dispatcherRunId?:       string;
  /** The shell line a release runs on the branch tip before it changes anything; absent on a tracker that never set one, which runs none. */
  checkCommand?:          string;
  /** The shell line that prepares a fresh worktree before a gate, and part of a gate's cache key; absent on a tracker that never set one. */
  installCommand?:        string;
  /** The patterns of the files the checks line resolves through, which V11 holds a branch to; absent on a tracker that never set them. */
  checksDefinitionFiles?: string[];
  /** The shell line whose standard output joins a gate's cache key, such as the toolchain's version; absent on a tracker that never set one. */
  gateKeyCommand?:        string;
  /** The folders a gate and install line may write besides the worktree and temp, absolute or `~/`; absent on a tracker that never set them. */
  gateCachePaths?:        string[];
  /** The number the next draft takes, never wound back; absent on a tracker that never opened a draft. */
  nextDraftId?:           number;
  /** The number the next job takes, never wound back; absent on a tracker that never launched a job. */
  nextJobId?:             number;
  /** The unsettled jobs, in launch order; an ended job leaves in the hold that ended it. Absent on a tracker that never launched one. */
  jobs?:                  Job[];
  /** The number the next decision takes, never wound back; absent on a tracker that never opened one. */
  nextDecisionId?:        number;
  /** The open decisions for the user, in opening order; an answered or withdrawn one leaves. Absent on a tracker that never opened one. */
  decisions?:             Decision[];
  /** The number the next incident takes, never wound back; absent on a tracker that never opened one. */
  nextIncidentId?:        number;
  /** The open incidents for the runner's orchestrator, in opening order; a closed one leaves. Absent on a tracker that never opened one. */
  incidents?:             Incident[];
  tasks:                  Task[];
}
