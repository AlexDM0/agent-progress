import type { Decision } from './Decision.ts';
import type { Incident } from './Incident.ts';
import type { Job }      from './Job.ts';
import type { Task }     from './Task.ts';

/** `relative` forms are stored raw (`"-2h"`, `"start"`, `"now"`) and resolved against an explicit `now` at layout time. */
export type ViewRange =
  | { kind: 'auto' }
  | { kind: 'absolute'; from: string; to: string; tickMinutes: number | null }
  | { kind: 'relative'; from: string; to: string; tickMinutes: number | null };

/** `paused`, never resumed or paused by the user, starts no new job until the user's go. */
export type RunnerState = 'running' | 'paused';

export interface TrackerProgress {
  trackerId:               string;
  project:                 string;
  startedAt:               string;
  view:                    ViewRange;
  /** Never wound back, not by a row removal and not by a clearing, so an id is never handed out twice. */
  nextTaskId:              number;
  /** How many agents may be in flight at once; absent on a tracker that never set one, which reads as the default. */
  concurrencyLimit?:       number;
  /** Where the user left the runner; absent on a tracker that never set one, which reads as `paused`. */
  runnerState?:            RunnerState;
  /** The number the next draft takes, never wound back; absent on a tracker that never opened a draft. */
  nextDraftId?:            number;
  /** The number the next job takes, never wound back; absent on a tracker that never launched a job. */
  nextJobId?:              number;
  /** The unsettled jobs, in launch order; an ended job leaves in the hold that ended it. Absent on a tracker that never launched one. */
  jobs?:                   Job[];
  /** The number the next decision takes, never wound back; absent on a tracker that never opened one. */
  nextDecisionId?:         number;
  /** The open decisions for the user, in opening order; an answered or withdrawn one leaves. Absent on a tracker that never opened one. */
  decisions?:              Decision[];
  /** The number the next incident takes, never wound back; absent on a tracker that never opened one. */
  nextIncidentId?:         number;
  /** The open incidents for the runner's orchestrator, in opening order; a closed one leaves. Absent on a tracker that never opened one. */
  incidents?:              Incident[];
  /** When the Overseer first started on this board, written once and kept by `clear`; absent on a board it never started on. */
  overseerFirstStartedAt?: string;
  tasks:                   Task[];
}
