import type {
  GateOutcome,
  InterruptionCause,
  JobKind,
  JobOutcome,
  JobRole,
  JobState,
  LandingKind,
  RunnerStopReason,
  SlotPhase
} from '../@types/Job.ts';

export const JOB_KINDS = ['build', 'review', 'merge', 'merge-agent', 'refresh', 'orchestrator', 'product-owner'] as const satisfies readonly JobKind[];

export const JOB_ROLES = [
  'builder',
  'reviewer',
  'merge-fix',
  'resolver',
  'resolution-review',
  'orchestrator',
  'product-owner',
] as const satisfies readonly JobRole[];

export const JOB_STATES = [
  'launching',
  'preparing',
  'running',
  'waiting-for-answer',
  'interrupted',
  'awaiting-answer',
  'verifying',
  'gating',
  'merging',
  'landing',
  'stopping',
] as const satisfies readonly JobState[];

export const JOB_OUTCOMES = [
  'built',
  'reviewed',
  'round-granted',
  'does-not-hold',
  'resolved',
  'cannot-resolve',
  'landed',
  'integrated',
  'refreshed',
  'wound-down',
  'failed',
  'blocked',
  'replaced',
  'stopped',
  'closed',
] as const satisfies readonly JobOutcome[];

export const INTERRUPTION_CAUSES = ['host-lost', 'agent-crashed', 'reboot', 'answer-delivery', 'usage-limit'] as const satisfies readonly InterruptionCause[];

/** The interruptions a resume counts in `crashResumes`; a reboot, an answer delivery or a usage limit is nobody's crash. */
export const CRASH_INTERRUPTION_CAUSES = ['host-lost', 'agent-crashed'] as const satisfies readonly InterruptionCause[];

export const SLOT_PHASES = ['merge-in', 'resolving', 'reviewing-resolution', 'gating', 'fixing', 'landing'] as const satisfies readonly SlotPhase[];

export const RUNNER_STOP_REASONS = ['stopped', 'handed-over'] as const satisfies readonly RunnerStopReason[];

export const LANDING_KINDS = ['landed', 'integrated'] as const satisfies readonly LandingKind[];

export const GATE_OUTCOMES = ['passed', 'failed', 'cannot-run'] as const satisfies readonly GateOutcome[];

export const JOB_ID_PREFIX = 'J';

/** The number the first job a tracker launches takes, `J1`: the lowest `nextJobId` a progress file may store. */
export const FIRST_JOB_NUMBER = 1;

/** The host instance a job's first launch spawns; a resume spawns the next one. */
export const FIRST_HOST_INSTANCE = 1;
