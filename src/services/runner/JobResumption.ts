/**
 * How an interrupted job comes back, design section 3.6: its next host instance runs `--resume <id>` alone in the same working directory,
 * told first that it was interrupted; a resume the vendor cannot take ends the job `replaced` and opens `resume-failed`; and the fresh job
 * after a `replaced` one is told that an earlier session's uncommitted changes are its work.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import type { EventLogEntry }                   from '../../lib/agent-host/EventLog.ts';
import type { AgentAdapter }                    from '../../lib/agent-launch/AgentAdapter.ts';
import { writeFileAtomically }                  from '../../lib/atomic-file/AtomicFile.ts';
import type { InterruptionCause, Job, JobKind } from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                       from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }                           from '../../lib/tracker-model/Board.ts';
import { HANDOFF_RED_INTERRUPTION }             from '../../lib/tracker-model/constants/JobStates.ts';
import { HostFleet }                            from './HostFleet.ts';
import { RedHandoff, type RedHandoffFacts }     from './RedHandoff.ts';

const FIRST_HOST_INSTANCE = 1;

export const RESUME_FAILED_CAUSE = 'resume-failed';

/** What a resumed session is told, worded by the command line: the plain resume line, or the red handoff it was resumed to fix. */
export interface ResumeMessages {
  resumeMessage:       string;
  redHandoffMessageOf: (facts: Readonly<RedHandoffFacts>) => string;
}

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

/** The newest earlier job of the same kind on the job's tickets that ended, with its outcome and the cause of its last interruption. */
function lastEndedPredecessorOf(logRecords: readonly LogRecord[], job: Readonly<Job>): { jobId: string; outcome: string; interruption: InterruptionCause | null } | null {
  const sameWorkJobIds = new Set<string>();
  const interruptionByJobId = new Map<string, InterruptionCause>();
  let predecessor: { jobId: string; outcome: string; interruption: InterruptionCause | null } | null = null;
  const sharesTheWork = (kind: JobKind, ticketIds: readonly string[]): boolean => kind === job.kind && ticketIds.some((ticketId) => job.ticketIds.includes(ticketId));
  for (const record of logRecords) {
    if (record.kind === 'job-launched' && record.jobId !== job.id && sharesTheWork(record.fields.kind, record.fields.ticketIds)) sameWorkJobIds.add(record.jobId);
    if (record.kind === 'job-interrupted') interruptionByJobId.set(record.jobId, record.fields.cause);
    if (record.kind === 'job-ended' && sameWorkJobIds.has(record.jobId)) {
      predecessor = { jobId: record.jobId, outcome: record.fields.outcome, interruption: interruptionByJobId.get(record.jobId) ?? null };
    }
  }
  return predecessor;
}

/**
 * The job whose session a build job carries on: a build of the same attempt after one that ended `built` was sent back by its review, and resumes that
 * builder's session (itself perhaps carried on from an earlier one) with the review's findings. The job itself for every other job.
 */
function sessionOwnerJobIdOf(logRecords: readonly LogRecord[], job: Readonly<Job>): string {
  if (job.kind !== 'build') return job.id;
  const sessionOwnerByJobId = new Map<string, string>();
  const attemptByJobId = new Map<string, number>();
  let newestEnded: { jobId: string; outcome: string } | null = null;
  for (const record of logRecords) {
    if (record.kind === 'job-launched' && record.fields.kind === 'build' && record.fields.ticketIds.some((ticketId) => job.ticketIds.includes(ticketId))) {
      const sameAttempt = newestEnded !== null && attemptByJobId.get(newestEnded.jobId) === record.fields.attempt;
      const carriesOn = sameAttempt && newestEnded?.outcome === 'built' ? sessionOwnerByJobId.get(newestEnded.jobId) : undefined;
      sessionOwnerByJobId.set(record.jobId, carriesOn ?? record.jobId);
      attemptByJobId.set(record.jobId, record.fields.attempt);
    }
    if (record.kind === 'job-ended' && sessionOwnerByJobId.has(record.jobId)) newestEnded = { jobId: record.jobId, outcome: record.fields.outcome };
  }
  return sessionOwnerByJobId.get(job.id) ?? job.id;
}

/** The `## Review <round>` section a builder resumed after its review is sent: the newest one in the ticket's body. */
function newestReviewSectionOf(ticketBody: string): string {
  const start = [...ticketBody.matchAll(/^## Review \d+/gm)].at(-1)?.index;
  if (start === undefined) return '';
  const rest = ticketBody.slice(start);
  const nextHeading = rest.slice(1).search(/^## /m);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1)).trim();
}

/** The newest earlier job of the same kind on the job's tickets ended `replaced`, so the job inherits that session's worktree. */
function earlierSessionWasReplaced(logRecords: readonly LogRecord[], job: Readonly<Job>): boolean {
  return lastEndedPredecessorOf(logRecords, job)?.outcome === 'replaced';
}

/**
 * The red handoff a fresh session takes over when the session it replaces, interrupted on a red handoff, could not be resumed: the same
 * facts, its calls counted from its own first instance. `null` for every other job.
 */
function redHandoffTakenOverOf(trackerDirectory: string, logRecords: readonly LogRecord[], job: Readonly<Job>): RedHandoffFacts | null {
  const predecessor = lastEndedPredecessorOf(logRecords, job);
  if (predecessor?.outcome !== 'replaced' || predecessor.interruption !== HANDOFF_RED_INTERRUPTION) return null;
  const facts = RedHandoff.redHandoffFactsOf(HostFleet.jobFolderOf(trackerDirectory, predecessor.jobId));
  return facts === null ? null : { ...facts, interruptedInstance: 0 };
}

/** The message a resumed instance opens with: User's reopening text, the red handoff it resumes to fix, or the plain resume message. */
function resumeLineOf(trackerDirectory: string, board: Pick<Board, 'logRecordsSoFar'>, job: Readonly<Job>, messages: ResumeMessages): string {
  const reopenText = reopenTextOf(board.logRecordsSoFar(), job);
  if (reopenText !== null) return reopenText;
  const redHandoff = job.interruption === HANDOFF_RED_INTERRUPTION ? RedHandoff.redHandoffFactsOf(HostFleet.jobFolderOf(trackerDirectory, job.id)) : null;
  return redHandoff === null ? messages.resumeMessage : messages.redHandoffMessageOf(redHandoff);
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
  messages: ResumeMessages,
  answerAwaitsDelivery: (job: Readonly<Job>) => boolean,
): Promise<void> {
  for (const job of board.jobs()) {
    if (job.state !== 'running' || !isResumedInstance(job) || job.interruption === 'answer-delivery' || answerAwaitsDelivery(job)) continue;
    const jobFolder = HostFleet.jobFolderOf(trackerDirectory, job.id);
    const marker    = resumeMessageMarkerOf(jobFolder, job.hostInstance);
    if (existsSync(marker) || HostFleet.livenessOf(jobFolder, job.hostInstance).verdict !== 'live') continue;
    const line = adapter.chatLineOf(resumeLineOf(trackerDirectory, board, job, messages));
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
  sessionOwnerJobIdOf,
  newestReviewSectionOf,
  redHandoffTakenOverOf,
  resumeLineOf,
  storeFirstMessage,
  deliverFirstMessages,
  deliverResumeMessages,
});
