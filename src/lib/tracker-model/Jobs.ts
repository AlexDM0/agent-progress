/**
 * The runner's jobs on the board: their launch, their moves through the one legality table, their interruptions, resumes and end, and
 * the cursor, answered requests and merge slot each carries. Only a launch, an interruption, a resume and an end are logged.
 */
import type { JobChanged, Logged } from './@types/BoardChanges.ts';
import type {
  InterruptionCause,
  Job,
  JobEnding,
  JobEventCursor,
  JobLaunch,
  JobMoveTarget,
  JobState,
  MergeSlot,
  RunnerStopReason
}                                   from './@types/Job.ts';
import type { LogRecord }                                           from './@types/LogRecord.ts';
import type { BoardRecords }                                        from './BoardRecords.ts';
import { BoardRefusal }                                             from './BoardRefusal.ts';
import { LEGAL_SOURCE_STATES_FOR_JOB_MOVE, PROCESSLESS_JOB_STATES } from './constants/JobMoveLegality.ts';
import {
  CRASH_INTERRUPTION_CAUSES,
  FIRST_HOST_INSTANCE,
  FIRST_JOB_NUMBER,
  JOB_ID_PREFIX
}                                   from './constants/JobStates.ts';

/** The states a plain move names: an interruption carries its cause. The table refuses `launching`, which only a launch enters. */
export type SteppedJobState = Exclude<JobState, 'interrupted'>;

const FIRST_EVENT_SEQUENCE = 0;

function jobNumberOf(jobId: string): number | null {
  const match = new RegExp(`^${JOB_ID_PREFIX}([1-9][0-9]*)$`).exec(jobId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function isProcessless(state: JobState): boolean {
  return (PROCESSLESS_JOB_STATES as readonly JobState[]).includes(state);
}

function isCrash(cause: InterruptionCause): boolean {
  return (CRASH_INTERRUPTION_CAUSES as readonly InterruptionCause[]).includes(cause);
}

export class Jobs {
  constructor(private readonly records: BoardRecords) {}

  /** In launch order. */
  jobs(): readonly Readonly<Job>[] {
    return this.records.progress.jobs ?? [];
  }

  jobById(jobId: string): Readonly<Job> | undefined {
    return this.jobs().find((job) => job.id === jobId);
  }

  launchJob(launch: JobLaunch, at: string): JobChanged {
    const job: Job = {
      id:                 this.takeNextJobId(),
      kind:               launch.kind,
      role:               launch.role,
      ticketIds:          [...launch.ticketIds],
      parentJobId:        launch.parentJobId,
      attempt:            launch.attempt,
      target:             launch.target,
      state:              'launching',
      hostInstance:       FIRST_HOST_INSTANCE,
      eventCursor:        { instance: FIRST_HOST_INSTANCE, sequence: FIRST_EVENT_SEQUENCE },
      answeredRequestIds: [],
      crashResumes:       0,
    };
    this.liveJobRecords().push(job);
    const logged = this.records.logger.log({
      kind:   'job-launched',
      jobId:  job.id,
      fields: {
        kind:        job.kind,
        role:        job.role,
        ticketIds:   [...job.ticketIds],
        attempt:     job.attempt,
        target:      job.target,
        parentJobId: job.parentJobId,
      },
    }, at);
    return { job, logged: [logged] };
  }

  /** A move into `running` from a state with no process is a resume: it spawns the next host instance and is logged. */
  moveJob(jobId: string, targetState: SteppedJobState, at: string): JobChanged {
    const job = this.requireLiveJob(jobId);
    this.refuseIllegalMove(job, targetState);
    const resumes = targetState === 'running' && isProcessless(job.state);
    job.state     = targetState;
    if (!resumes) return { job, logged: [] };

    const cause      = job.interruption ?? 'host-lost';
    job.hostInstance += 1;
    if (isCrash(cause)) job.crashResumes += 1;
    return { job, logged: [this.records.logger.log({ kind: 'job-resumed', jobId, fields: { hostInstance: job.hostInstance, cause } }, at)] };
  }

  interruptJob(jobId: string, cause: InterruptionCause, at: string): JobChanged {
    const job = this.requireLiveJob(jobId);
    this.refuseIllegalMove(job, 'interrupted');
    job.state        = 'interrupted';
    job.interruption = cause;
    return { job, logged: [this.records.logger.log({ kind: 'job-interrupted', jobId, fields: { cause, hostInstance: job.hostInstance } }, at)] };
  }

  /** The only way a job finishes: it leaves the board in this hold and lives on in the log, and every later move of it is refused. */
  endJob(jobId: string, ending: JobEnding, at: string): JobChanged {
    const job = this.requireLiveJob(jobId);
    this.refuseIllegalMove(job, 'ended');
    const liveJobs = this.liveJobRecords();
    liveJobs.splice(liveJobs.indexOf(job), 1);
    job.outcome = ending.outcome;
    const logged = this.records.logger.log({
      kind:   'job-ended',
      jobId,
      fields: {
        outcome:           ending.outcome,
        ...(ending.cause === undefined ? {} : { cause: ending.cause }),
        ...(ending.commit === undefined ? {} : { commit: ending.commit }),
        deniedPermissions: [...(ending.deniedPermissions ?? [])],
      },
    }, at);
    return { job, logged: [logged] };
  }

  setJobEventCursor(jobId: string, cursor: JobEventCursor): Readonly<Job> {
    const job       = this.requireLiveJob(jobId);
    job.eventCursor = { instance: cursor.instance, sequence: cursor.sequence };
    return job;
  }

  /** A request id answered twice is kept once. */
  addAnsweredRequestId(jobId: string, requestId: string): Readonly<Job> {
    const job = this.requireLiveJob(jobId);
    if (!job.answeredRequestIds.includes(requestId)) job.answeredRequestIds.push(requestId);
    return job;
  }

  /** A `null` slot frees the one the job held. */
  setJobSlot(jobId: string, slot: MergeSlot | null): Readonly<Job> {
    const job = this.requireLiveJob(jobId);
    if (slot === null) delete job.slot;
    else job.slot = {
      target: slot.target, targetTip: slot.targetTip, branchTip: slot.branchTip, phase: slot.phase
    };
    return job;
  }

  recordRunnerStarted(versions: { codeVersion: string; installVersion: number }, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'runner-started', fields: { codeVersion: versions.codeVersion, installVersion: versions.installVersion } }, at)] };
  }

  recordRunnerStopped(reason: RunnerStopReason, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'runner-stopped', fields: { reason } }, at)] };
  }

  recordUsageLimitHit(jobId: string, limit: { window: string; resetsAt: string }, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'usage-limit-hit', jobId, fields: { window: limit.window, resetsAt: limit.resetsAt } }, at)] };
  }

  recordRelayApplied(jobId: string, applied: { requestId: string; commandKind: string; outcome: string }, at: string): Logged {
    const fields = { requestId: applied.requestId, commandKind: applied.commandKind, outcome: applied.outcome };
    return { logged: [this.records.logger.log({ kind: 'relay-applied', jobId, fields }, at)] };
  }

  /** Read from the stored log and this hold's records alike, so a request answered in an earlier pass or earlier in this one is never applied again. */
  relayRequestIsApplied(requestId: string): boolean {
    const isTheRequest = (record: LogRecord): boolean => record.kind === 'relay-applied' && record.fields.requestId === requestId;
    return this.records.storedLogRecords.some(isTheRequest) || this.records.loggedRecords.some(isTheRequest);
  }

  private refuseIllegalMove(job: Readonly<Job>, targetState: JobMoveTarget): void {
    if (LEGAL_SOURCE_STATES_FOR_JOB_MOVE[targetState].includes(job.state)) return;
    throw new BoardRefusal({
      reason: 'job-move-illegal', jobId: job.id, state: job.state, targetState
    });
  }

  /** A job leaves the board only by ending, so a well-formed id below the counter that the board no longer holds is a finished job. */
  private requireLiveJob(jobId: string): Job {
    const job = this.records.progress.jobs?.find((candidate) => candidate.id === jobId);
    if (job !== undefined) return job;
    const jobNumber = jobNumberOf(jobId);
    if (jobNumber !== null && jobNumber < (this.records.progress.nextJobId ?? FIRST_JOB_NUMBER)) throw new BoardRefusal({ reason: 'job-finished', jobId });
    throw new BoardRefusal({ reason: 'unknown-job', jobId });
  }

  /** Adds the list on first use, so a tracker that never launched a job stores none. */
  private liveJobRecords(): Job[] {
    this.records.progress.jobs ??= [];
    return this.records.progress.jobs;
  }

  /** The counter is stored and never wound back, so an ended job's id is never handed to a new one. */
  private takeNextJobId(): string {
    const highestLiveNumber        = this.jobs().reduce((highest, job) => Math.max(highest, jobNumberOf(job.id) ?? 0), 0);
    const allocated                = Math.max(this.records.progress.nextJobId ?? FIRST_JOB_NUMBER, highestLiveNumber + 1);
    this.records.progress.nextJobId = allocated + 1;
    return `${JOB_ID_PREFIX}${allocated}`;
  }
}
