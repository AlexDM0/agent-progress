/**
 * How an interrupted job comes back, design section 3.6: its next host instance runs `--resume <id>` alone in the same working directory,
 * told first that it was interrupted; a resume the vendor cannot take ends the job `replaced` and opens `resume-failed`; and the fresh job
 * after a `replaced` one is told that an earlier session's uncommitted changes are its work.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import type { EventLogEntry }  from '../../lib/agent-host/EventLog.ts';
import type { AgentAdapter }   from '../../lib/agent-launch/AgentAdapter.ts';
import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import type { Job, JobKind }   from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }      from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }          from '../../lib/tracker-model/Board.ts';
import { HostFleet }           from './HostFleet.ts';

const FIRST_HOST_INSTANCE = 1;

export const RESUME_FAILED_CAUSE = 'resume-failed';

/** Only a resume increments a job's host instance, so every instance past the first runs a resumed session. */
function isResumedInstance(job: Readonly<Job>): boolean {
  return job.hostInstance > FIRST_HOST_INSTANCE;
}

/** User's message that reopened a closed product owner in the job's current instance; `null` for every other instance. */
function reopenTextOf(logRecords: readonly LogRecord[], job: Readonly<Job>): string | null {
  const reopened = logRecords.findLast((record) => record.kind === 'job-reopened' && record.jobId === job.id && record.fields.hostInstance === job.hostInstance);
  return reopened?.kind === 'job-reopened' ? reopened.fields.text : null;
}

/**
 * What a launch of the job's current instance passes the adapter: a resume is told it was interrupted, never handed its task again, and a
 * reopened session gets User's message instead.
 */
function launchPartsOf(job: Readonly<Job>, firstMessage: string, resumeMessage: string, reopenText: string | null = null): { resume: boolean; firstMessage: string } {
  return isResumedInstance(job) ? { resume: true, firstMessage: reopenText ?? resumeMessage } : { resume: false, firstMessage };
}

/** Whether the instance's whole event log holds its session's start; read only for a resumed instance whose host is gone. */
function instanceSessionStarted(jobFolder: string, instance: number, adapter: AgentAdapter): boolean {
  const entries: readonly EventLogEntry[] | 'malformed' = HostFleet.eventsAfter(jobFolder, instance, 0);
  if (entries === 'malformed') return true;
  return entries.some((entry) => entry.origin === 'agent' && adapter.eventsOf(entry.line).some((event) => event.kind === 'started'));
}

/**
 * A resumed session that exited by itself before it ever started: the vendor could not resume it. One killed or lost to a reboot before it
 * started is interrupted again instead.
 */
function resumeFailed(job: Readonly<Job>, sessionExitedByItself: boolean, sessionStarted: boolean): boolean {
  return isResumedInstance(job) && sessionExitedByItself && !sessionStarted;
}

function applyResumeFailure(board: Board, job: Readonly<Job>, at: string): void {
  board.endJob(job.id, { outcome: 'replaced', cause: RESUME_FAILED_CAUSE }, at);
  board.openIncident({
    kind:        'resume-failed',
    ticketIds:   job.ticketIds,
    jobId:       job.id,
    facts:       { hostInstance: String(job.hostInstance) },
    defaultMove: 'job-fresh',
  }, at);
}

/** The newest earlier job of the same kind on the job's tickets ended `replaced`, so the job inherits that session's worktree. */
function earlierSessionWasReplaced(logRecords: readonly LogRecord[], job: Readonly<Job>): boolean {
  const sameWorkJobIds = new Set<string>();
  let lastOutcome: string | null = null;
  const sharesTheWork = (kind: JobKind, ticketIds: readonly string[]): boolean => kind === job.kind && ticketIds.some((ticketId) => job.ticketIds.includes(ticketId));
  for (const record of logRecords) {
    if (record.kind === 'job-launched' && record.jobId !== job.id && sharesTheWork(record.fields.kind, record.fields.ticketIds)) sameWorkJobIds.add(record.jobId);
    if (record.kind === 'job-ended' && sameWorkJobIds.has(record.jobId)) lastOutcome = record.fields.outcome;
  }
  return lastOutcome === 'replaced';
}

function resumeMessageMarkerOf(jobFolder: string, instance: number): string {
  return join(jobFolder, `resume-message-${instance}.sent`);
}

function firstMessagePathOf(jobFolder: string, instance: number): string {
  return join(jobFolder, `first-message-${instance}.txt`);
}

function firstMessageMarkerOf(jobFolder: string, instance: number): string {
  return join(jobFolder, `first-message-${instance}.sent`);
}

/** Kept beside a fresh instance's launch files until a pass finds its Watcher live, so an Overseer restart in between loses nothing. */
function storeFirstMessage(jobFolder: string, instance: number, message: string): void {
  writeFileAtomically(firstMessagePathOf(jobFolder, instance), message);
}

/**
 * The task text of each fresh instance, its session's first input, written once its Watcher answers. The marker is written only after the
 * Watcher took the line, so one not yet listening is tried again on the next pass, and a delivered line is never sent twice.
 */
async function deliverFirstMessages(trackerDirectory: string, board: Pick<Board, 'jobs'>, adapter: Pick<AgentAdapter, 'chatLineOf'>): Promise<void> {
  for (const job of board.jobs()) {
    if (isResumedInstance(job)) continue;
    const jobFolder   = HostFleet.jobFolderOf(trackerDirectory, job.id);
    const messagePath = firstMessagePathOf(jobFolder, job.hostInstance);
    const marker      = firstMessageMarkerOf(jobFolder, job.hostInstance);
    if (!existsSync(messagePath) || existsSync(marker) || HostFleet.livenessOf(jobFolder, job.hostInstance).verdict !== 'live') continue;
    const line = adapter.chatLineOf(readFileSync(messagePath, 'utf8'));
    if (await HostFleet.sendFrames(jobFolder, job.hostInstance, [{ kind: 'write', line }])) writeFileSync(marker, '');
  }
}

/**
 * The first line of each resumed instance, written once its host answers; an answer delivery is resumed with the answer instead. The marker
 * is written only after the host took the line, so a host not yet listening is tried again on the next pass.
 */
async function deliverResumeMessages(
  trackerDirectory: string,
  board: Board,
  adapter: AgentAdapter,
  resumeMessage: string,
  answerAwaitsDelivery: (job: Readonly<Job>) => boolean,
): Promise<void> {
  for (const job of board.jobs()) {
    if (job.state !== 'running' || !isResumedInstance(job) || job.interruption === 'answer-delivery' || answerAwaitsDelivery(job)) continue;
    const jobFolder = HostFleet.jobFolderOf(trackerDirectory, job.id);
    const marker    = resumeMessageMarkerOf(jobFolder, job.hostInstance);
    if (existsSync(marker) || HostFleet.livenessOf(jobFolder, job.hostInstance).verdict !== 'live') continue;
    const line = adapter.chatLineOf(reopenTextOf(board.logRecordsSoFar(), job) ?? resumeMessage);
    if (await HostFleet.sendFrames(jobFolder, job.hostInstance, [{ kind: 'write', line }])) writeFileSync(marker, '');
  }
}

export const JobResumption = Object.freeze({
  isResumedInstance,
  reopenTextOf,
  launchPartsOf,
  instanceSessionStarted,
  resumeFailed,
  applyResumeFailure,
  earlierSessionWasReplaced,
  storeFirstMessage,
  deliverFirstMessages,
  deliverResumeMessages,
});
