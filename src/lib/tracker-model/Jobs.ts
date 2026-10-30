/**
 * The Overseer's jobs on the board: their launch, their moves through the one legality table, their interruptions, resumes, end and
 * reopening, and the cursor, answered requests and Airlock each carries. Only a launch, an interruption, a resume, an end and a reopening
 * are logged.
 */
import type { JobChanged, Logged } from './@types/BoardChanges.ts';
import type {
  InterruptionCause,
  Job,
  JobEnding,
  JobEventCursor,
  JobIntake,
  JobLaunch,
  JobMoveTarget,
  JobOutcome,
  JobState,
  JobStopMode,
  Airlock,
  OverseerStopReason
}                                   from './@types/Job.ts';
import type { LogRecord }                                           from './@types/LogRecord.ts';
import type { BoardRecords }                                        from './BoardRecords.ts';
import { BoardRefusal }                                             from './BoardRefusal.ts';
import { LEGAL_SOURCE_STATES_FOR_JOB_MOVE, PROCESSLESS_JOB_STATES } from './constants/JobMoveLegality.ts';
import {
  CRASH_INTERRUPTION_CAUSES,
  FIRST_WATCHER_INSTANCE,
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
      watcherInstance:    FIRST_WATCHER_INSTANCE,
      eventCursor:        { instance: FIRST_WATCHER_INSTANCE, sequence: FIRST_EVENT_SEQUENCE },
      answeredRequestIds: [],
      crashResumes:       0,
      ...(launch.intake === undefined ? {} : { intake: { ...launch.intake } }),
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

  /** A move into `running` from a state with no process is a resume: it spawns the next Watcher instance and is logged. */
  moveJob(jobId: string, targetState: SteppedJobState, at: string): JobChanged {
    const job = this.requireLiveJob(jobId);
    this.refuseIllegalMove(job, targetState);
    const resumes = targetState === 'running' && isProcessless(job.state);
    job.state     = targetState;
    if (!resumes) return { job, logged: [] };

    const cause      = job.interruption ?? 'watcher-lost';
    job.watcherInstance += 1;
    if (isCrash(cause)) job.crashResumes += 1;
    return { job, logged: [this.records.logger.log({ kind: 'job-resumed', jobId, fields: { watcherInstance: job.watcherInstance, cause } }, at)] };
  }

  interruptJob(jobId: string, cause: InterruptionCause, at: string): JobChanged {
    const job = this.requireLiveJob(jobId);
    this.refuseIllegalMove(job, 'interrupted');
    job.state        = 'interrupted';
    job.interruption = cause;
    return { job, logged: [this.records.logger.log({ kind: 'job-interrupted', jobId, fields: { cause, watcherInstance: job.watcherInstance } }, at)] };
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

  /** Kept on the job so the Overseer sends its frames from the board; a later request replaces an earlier one. */
  recordStopRequest(jobId: string, mode: JobStopMode, at: string): JobChanged {
    const job       = this.requireLiveJob(jobId);
    job.stopRequest = mode;
    return { job, logged: [this.records.logger.log({ kind: 'job-stop-requested', jobId, fields: { mode } }, at)] };
  }

  /** The outcome and kind of a job that left the board, read from its log records; `undefined` for a live or unknown one. */
  endedJobOutcomeOf(jobId: string): { kind: Job['kind']; outcome: JobOutcome } | undefined {
    if (this.jobById(jobId) !== undefined) return undefined;
    const records  = this.logRecordsSoFar();
    const launched = records.find((record) => record.kind === 'job-launched' && record.jobId === jobId);
    const ended    = records.findLast((record) => record.kind === 'job-ended' && record.jobId === jobId);
    if (launched?.kind !== 'job-launched' || ended?.kind !== 'job-ended') return undefined;
    return { kind: launched.fields.kind, outcome: ended.fields.outcome };
  }

  /**
   * Puts an ended job back on the board from its log records, `running` in its next Watcher instance, so the Overseer launches it resuming the
   * same session; the caller decides which ended jobs may come back.
   */
  reopenEndedJob(jobId: string, reopening: { text: string; offeredTicketIds: readonly string[]; intake?: JobIntake }, at: string): JobChanged {
    const records  = this.logRecordsSoFar().filter((record) => 'jobId' in record && record.jobId === jobId);
    const launched = records.find((record) => record.kind === 'job-launched');
    if (launched?.kind !== 'job-launched' || this.jobById(jobId) !== undefined) return this.recordMessage(jobId, reopening.text, at);
    const lastWatcherInstance = records.reduce((highest, record) => (
      (record.kind === 'job-resumed' || record.kind === 'job-interrupted' || record.kind === 'job-reopened') ? Math.max(highest, record.fields.watcherInstance) : highest
    ), FIRST_WATCHER_INSTANCE);
    const watcherInstance = lastWatcherInstance + 1;
    const job: Job = {
      id:                 jobId,
      kind:               launched.fields.kind,
      role:               launched.fields.role,
      ticketIds:          [...launched.fields.ticketIds],
      parentJobId:        launched.fields.parentJobId,
      attempt:            launched.fields.attempt,
      target:             launched.fields.target,
      state:              'running',
      watcherInstance,
      eventCursor:        { instance: watcherInstance, sequence: FIRST_EVENT_SEQUENCE },
      answeredRequestIds: [],
      crashResumes:       0,
      ...(reopening.intake === undefined ? {} : { intake: { ...reopening.intake } }),
    };
    this.liveJobRecords().push(job);
    const fields = { watcherInstance, text: reopening.text, offeredTicketIds: [...reopening.offeredTicketIds] };
    return { job, logged: [this.records.logger.log({ kind: 'job-reopened', jobId, fields }, at)] };
  }

  /** A finished session is continued only by `reopenEndedJob`: a session whose input is closing is refused like an ended job. */
  recordMessage(jobId: string, text: string, at: string): JobChanged {
    const job = this.requireLiveJob(jobId);
    if (job.state === 'stopping') throw new BoardRefusal({ reason: 'job-finished', jobId });
    return { job, logged: [this.records.logger.log({ kind: 'job-messaged', jobId, fields: { text } }, at)] };
  }

  setProposedDraftSets(jobId: string, proposedDraftSets: readonly (readonly string[])[]): Readonly<Job> {
    const job = this.requireLiveJob(jobId);
    job.intake = { ...job.intake ?? { text: '' }, proposedDraftSets: proposedDraftSets.map((draftSet) => [...draftSet]) };
    return job;
  }

  /** Refused `unknown-job` or `job-finished` like every other move, so a control names why it cannot act. */
  requireJob(jobId: string): Readonly<Job> {
    return this.requireLiveJob(jobId);
  }

  /** A `null` slot frees the one the job held. */
  setJobSlot(jobId: string, slot: Airlock | null): Readonly<Job> {
    const job = this.requireLiveJob(jobId);
    if (slot === null) delete job.airlock;
    else job.airlock = {
      target: slot.target, targetTip: slot.targetTip, branchTip: slot.branchTip, phase: slot.phase
    };
    return job;
  }

  recordOverseerStarted(versions: { codeVersion: string; installVersion: number }, at: string): Logged {
    this.records.progress.overseerFirstStartedAt ??= at;
    return { logged: [this.records.logger.log({ kind: 'overseer-started', fields: { codeVersion: versions.codeVersion, installVersion: versions.installVersion } }, at)] };
  }

  recordOverseerStopped(reason: OverseerStopReason, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'overseer-stopped', fields: { reason } }, at)] };
  }

  recordBatonPassFailed(failure: { successorCodeVersion: string; step: string; error: string }, at: string): Logged {
    const fields = { successorCodeVersion: failure.successorCodeVersion, step: failure.step, error: failure.error };
    return { logged: [this.records.logger.log({ kind: 'baton-pass-failed', fields }, at)] };
  }

  recordUsageLimitHit(jobId: string, limit: { window: string; resetsAt: string }, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'usage-limit-hit', jobId, fields: { window: limit.window, resetsAt: limit.resetsAt } }, at)] };
  }

  recordHatchApplied(jobId: string, applied: { requestId: string; commandKind: string; outcome: string }, at: string): Logged {
    const fields = { requestId: applied.requestId, commandKind: applied.commandKind, outcome: applied.outcome };
    return { logged: [this.records.logger.log({ kind: 'hatch-applied', jobId, fields }, at)] };
  }

  /** Read from the stored log and this hold's records alike, so a request answered in an earlier pass or earlier in this one is never applied again. */
  hatchRequestIsApplied(requestId: string): boolean {
    const isTheRequest = (record: LogRecord): boolean => record.kind === 'hatch-applied' && record.fields.requestId === requestId;
    return this.records.storedLogRecords.some(isTheRequest) || this.records.loggedRecords.some(isTheRequest);
  }

  private logRecordsSoFar(): LogRecord[] {
    return [...this.records.storedLogRecords, ...this.records.loggedRecords];
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
