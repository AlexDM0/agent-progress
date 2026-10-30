/** Synthetic facts, jobs and log records for the lifecycle policy's specs, every value a test does not name set to the quiet default. */
import type {
  InterruptionCause,
  Job,
  JobKind,
  JobOutcome
} from '../@types/Job.ts';
import type { LifecycleLimits }                      from '../@types/LifecycleLimits.ts';
import type { LifecycleObservations, LifecycleStep } from '../@types/LifecycleStep.ts';
import type { LogRecord }                            from '../@types/LogRecord.ts';
import type { TicketStatus }                         from '../@types/Ticket.ts';
import type { LifecycleFacts, LifecycleTicket }      from '../LifecyclePolicy.ts';

export const FIXTURE_AT = '2026-10-28T10:00:00+01:00';

export const FIXTURE_OBSERVATIONS: LifecycleObservations = {
  mainLine:                     'main',
  groupTargetPrefix:            'group-',
  installVersionChanged:        false,
  targetsHoldingManagedBlock:   [],
  ticketIdsTouchingAgentConfig: [],
  closedDeliveryTurns:          [],
  budgetSpentDeliveryTurns:     [],
  orchestratorHasAnswered:      false,
  orchestratorBootRetryDue:     false,
};

/** The values `src/shared/constants/LifecycleLimits.ts` passes in, which the tracker model may not import. */
export const FIXTURE_LIMITS: LifecycleLimits = {
  FAILED_PASSES_BEFORE_PARKING:                2,
  CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING:     2,
  ROUND_GRANTED_ON_REWORK_ALONE:               2,
  FINDINGS_SHRINK_FACTOR_PER_ROUND:            2,
  REWORK_ROUND_THRESHOLD_LINES:                750,
  JOB_RESUMES_BEFORE_FRESH:                    2,
  RED_HANDOFF_RESUMES_BEFORE_PARKING:          2,
  REPLACED_JOBS_BEFORE_JOB_LOST:               2,
  FAILED_ORCHESTRATOR_BOOTS_BEFORE_DEFAULTING: 2,
  now:                                         FIXTURE_AT,
  usageResetsAt:                               null,
};

export function jobFixture(overrides: Partial<Job> & Pick<Job, 'id'>): Job {
  return {
    kind:               'build',
    role:               'builder',
    ticketIds:          [],
    parentJobId:        null,
    attempt:            1,
    target:             'main',
    state:              'running',
    hostInstance:       1,
    eventCursor:        { instance: 1, sequence: 0 },
    answeredRequestIds: [],
    crashResumes:       0,
    ...overrides,
  };
}

/** The live orchestrator every fact set starts with, so a spec sees no `boot-orchestrator` it did not ask for. */
export const LIVE_ORCHESTRATOR = jobFixture({
  id: 'J900', kind: 'orchestrator', role: 'orchestrator', target: null
});

export function ticketOf(id: string, status: TicketStatus, overrides: Partial<LifecycleTicket> = {}): LifecycleTicket {
  return { id, status, ...overrides };
}

export function factsWith(overrides: Partial<LifecycleFacts> = {}): LifecycleFacts {
  return {
    tickets:                     [],
    jobs:                        [LIVE_ORCHESTRATOR],
    decisions:                   [],
    incidents:                   [],
    logRecords:                  [],
    readinessPositionByTicketId: new Map(),
    concurrencyLimit:            3,
    dispatcherState:             'running',
    pipelineIsSet:               true,
    observations:                FIXTURE_OBSERVATIONS,
    ...overrides,
  };
}

export function launchedRecord(jobId: string, kind: JobKind, ticketIds: readonly string[], attempt: number = 1): LogRecord {
  return {
    kind:   'job-launched',
    jobId,
    fields: {
      kind, role: null, ticketIds, attempt, target: 'main', parentJobId: null,
    },
    at: FIXTURE_AT,
  };
}

export function endedRecord(jobId: string, outcome: JobOutcome): LogRecord {
  return {
    kind: 'job-ended', jobId, fields: { outcome, deniedPermissions: [] }, at: FIXTURE_AT,
  };
}

export function interruptedRecord(jobId: string, cause: InterruptionCause): LogRecord {
  return {
    kind: 'job-interrupted', jobId, fields: { cause, hostInstance: 1 }, at: FIXTURE_AT,
  };
}

export function ticketRecord(kind: 'ticket-started' | 'ticket-finished' | 'ticket-unheld' | 'ticket-readied', ticketId: string): LogRecord {
  return {
    kind, ticketId, fields: {}, at: FIXTURE_AT,
  };
}

/** A job of `kind` on the ticket that was launched and ended with `outcome`. */
export function finishedJobRecords(jobId: string, kind: JobKind, ticketId: string, outcome: JobOutcome, attempt: number = 1): LogRecord[] {
  return [launchedRecord(jobId, kind, [ticketId], attempt), endedRecord(jobId, outcome)];
}

export function launchedTicketIdsOf(steps: readonly LifecycleStep[]): string[] {
  return steps.flatMap((step) => (step.kind === 'launch-build' || step.kind === 'launch-review' ? [step.ticketId] : []));
}

export function stepKindsOf(steps: readonly LifecycleStep[]): string[] {
  return steps.map((step) => step.kind);
}
