/** Every threshold the Playbook, the round verdict and the Overseer's jobs decide by, passed into the tracker model as `limits`. */
import type { LifecycleThresholds } from '../../lib/tracker-model/@types/LifecycleLimits.ts';
import { DISPATCH_PROTOCOL }        from './DispatchProtocol.ts';

export const LIFECYCLE_LIMITS = {
  FAILED_PASSES_BEFORE_PARKING:             2,
  // Agents that died back to back, across tickets, are a session limit or an outage rather than tickets failing: dispatching stops instead of parking.
  CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING:  2,
  ROUND_GRANTED_ON_REWORK_ALONE:            2,
  FINDINGS_SHRINK_FACTOR_PER_ROUND:         2,
  REWORK_ROUND_THRESHOLD_LINES:             DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES,
  JOB_RESUMES_BEFORE_FRESH:                 2,
  // A red gate or Customs check resumes the same session this many times in one handoff cycle; the next red parks the ticket.
  RED_HANDOFF_RESUMES_BEFORE_PARKING:       2,
  REPLACED_JOBS_BEFORE_JOB_LOST:            2,
  FAILED_ASSISTANT_BOOTS_BEFORE_DEFAULTING: 2,
} as const satisfies LifecycleThresholds;
