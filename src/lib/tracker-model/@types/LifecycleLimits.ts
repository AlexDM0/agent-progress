/** What the Playbook decides by that the board does not hold: every threshold, the usage marker's reset and the stamp of this pass. */
import type { RoundLimits } from './ReviewRound.ts';

export interface LifecycleThresholds extends RoundLimits {
  FAILED_PASSES_BEFORE_PARKING:             number;
  CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING:  number;
  JOB_RESUMES_BEFORE_FRESH:                 number;
  RED_HANDOFF_RESUMES_BEFORE_PARKING:       number;
  REPLACED_JOBS_BEFORE_JOB_LOST:            number;
  FAILED_ASSISTANT_BOOTS_BEFORE_DEFAULTING: number;
}

export interface LifecycleLimits extends LifecycleThresholds {
  /** The stamp every record this pass writes carries; the policy compares it only with `usageResetsAt`. */
  now:           string;
  /** The usage marker's reset, `null` while no usage limit is marked. */
  usageResetsAt: string | null;
}
