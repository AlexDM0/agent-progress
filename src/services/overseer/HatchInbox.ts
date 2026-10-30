/**
 * The Overseer's side of the Hatch: every job's folder `<W>/hatch/<J>/` is mapped to its job record, which alone gives the request its job
 * and role; a folder whose job is neither live nor awaiting verification is not read. Each pending request is applied in the DrivePass
 * hold through the role policy and `ControlService`, its id logged on a `hatch-applied` record so a replay never applies it twice, and
 * its reply written once the hold committed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';

import type { HatchReply }                               from '../../adapters/hatch/@types/HatchFormat.ts';
import { hatchReplyFilePathOf, hatchRequestFilePathOf }  from '../../adapters/hatch/HatchFolder.ts';
import { HatchFormatUtil }                               from '../../adapters/hatch/utils/HatchFormatUtil.ts';
import { writeFileAtomically }                           from '../../lib/atomic-file/AtomicFile.ts';
import type { Job, JobState }                            from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                                    from '../../lib/tracker-model/Board.ts';
import { BoardRefusal }                                  from '../../lib/tracker-model/BoardRefusal.ts';
import { OperationRefusal, type OperationRefusalDetail } from '../../shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                 from '../../shared/constants/ProductNames.ts';
import { Bouncer, type RelayingJob }                     from '../control/Bouncer.ts';
import { ControlService }                                from '../control/ControlService.ts';
import type { TrackerChange }                            from '../tracker/TrackerPipeline.ts';

export interface PendingHatchRequest {
  jobId:     string;
  requestId: string;
  text:      string;
}

export interface HatchReplyToWrite {
  hatchDirectory: string;
  reply:          HatchReply;
}

/** A job past verification has nothing a session could still be waiting on, and an ended one has left the board. */
const HATCH_READABLE_STATES: ReadonlySet<JobState> = new Set([
  'launching', 'preparing', 'running', 'waiting-for-answer', 'interrupted', 'awaiting-answer', 'in-customs', 'stopping',
]);

const REQUEST_FILE_PATTERN = /^(.+)\.json$/;
const HATCH_FORMAT_VERSION = 1;

function hatchDirectoryOf(repositoryRoot: string, jobId: string): string {
  return join(repositoryRoot, PRODUCT_NAMES.WORKTREES_FOLDER, 'hatch', jobId);
}

function hatchIsReadable(job: Readonly<Job> | undefined): boolean {
  return job !== undefined && HATCH_READABLE_STATES.has(job.state);
}

function requestIdsIn(hatchDirectory: string): string[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(join(hatchDirectory, 'requests'));
  } catch {
    return [];
  }
  return fileNames.map((fileName) => REQUEST_FILE_PATTERN.exec(fileName)?.[1]).filter((requestId): requestId is string => requestId !== undefined).sort();
}

function replyExists(hatchDirectory: string, requestId: string): boolean {
  try {
    readFileSync(hatchReplyFilePathOf(hatchDirectory, requestId));
    return true;
  } catch {
    return false;
  }
}

/** A request naming a format this Overseer does not read waits for an Overseer that does, after a Baton pass; one naming none is malformed. */
function namesAnotherFormat(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const formatVersion = (parsed as { hatchFormatVersion?: unknown }).hatchFormatVersion;
    return typeof formatVersion === 'number' && formatVersion !== HATCH_FORMAT_VERSION;
  } catch {
    return false;
  }
}

/** Outside the lock: every unanswered request of each job whose folder may be read, in request-id order within a job. */
function pendingRequestsOf(repositoryRoot: string, jobs: readonly Readonly<Job>[]): PendingHatchRequest[] {
  return jobs.filter(hatchIsReadable).flatMap((job) => {
    const hatchDirectory = hatchDirectoryOf(repositoryRoot, job.id);
    return requestIdsIn(hatchDirectory)
      .filter((requestId) => !replyExists(hatchDirectory, requestId))
      .flatMap((requestId) => {
        try {
          const text = readFileSync(hatchRequestFilePathOf(hatchDirectory, requestId), 'utf8');
          return namesAnotherFormat(text) ? [] : [{ jobId: job.id, requestId, text }];
        } catch {
          return [];
        }
      });
  });
}

function relayingJobOf(board: Board, job: Readonly<Job>): RelayingJob {
  return {
    id:           job.id,
    role:         job.role,
    filedTickets: board.tickets()
      .filter((ticket) => ticket.frontmatter.filedByJob === job.id)
      .map((ticket) => ({ id: ticket.frontmatter.id, status: ticket.frontmatter.status })),
    deliveredIncidents: board.incidents().filter((incident) => incident.deliveredInTurn?.jobId === job.id),
  };
}

/** The tickets a control command's result names, so the relayed verb can print them as a direct run would. */
function ticketIdsOf(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return [];
  const { ticket, tickets } = result as { ticket?: { frontmatter?: { id?: unknown } }; tickets?: { frontmatter?: { id?: unknown } }[] };
  const named = [...(ticket === undefined ? [] : [ticket]), ...(Array.isArray(tickets) ? tickets : [])];
  return named.map((each) => each.frontmatter?.id).filter((ticketId): ticketId is string => typeof ticketId === 'string');
}

function refusedReply(requestId: string, status: OperationRefusal['status'], detail: OperationRefusalDetail): HatchReply {
  return {
    hatchFormatVersion: HATCH_FORMAT_VERSION, requestId, outcome: 'refused', status, detail
  };
}

function replyOfRefusal(requestId: string, thrown: unknown): HatchReply {
  if (thrown instanceof BoardRefusal) return refusedReply(requestId, 'refused', { kind: 'board-refusal', boardRefusal: thrown.detail });
  if (thrown instanceof OperationRefusal && thrown.detail !== null) return refusedReply(requestId, thrown.status, thrown.detail);
  throw thrown;
}

function replyOf(change: TrackerChange, job: Readonly<Job>, request: PendingHatchRequest): { reply: HatchReply; commandKind: string } {
  const reading = HatchFormatUtil.requestReadingOf(request.text);
  if (reading.verdict === 'refused') {
    const detail: OperationRefusalDetail = reading.reason === 'hatch-identity-mismatch'
      ? { kind: 'hatch-identity-mismatch', requestId: request.requestId, jobId: job.id }
      : { kind: 'malformed-hatch-request', requestId: request.requestId };
    return { reply: refusedReply(request.requestId, 'refused', detail), commandKind: 'unread' };
  }
  // The file's name is the id the session waits on; a body naming another is a request copied from elsewhere.
  if (reading.requestId !== request.requestId) {
    const detail: OperationRefusalDetail = { kind: 'hatch-identity-mismatch', requestId: request.requestId, jobId: job.id };
    return { reply: refusedReply(request.requestId, 'refused', detail), commandKind: reading.command.kind };
  }
  const verdict = Bouncer.verdictOf(relayingJobOf(change.board, job), reading.command);
  if (verdict.verdict === 'refused') {
    const detail: OperationRefusalDetail = { kind: 'role-command-refused', reason: verdict.reason, commandKind: reading.command.kind };
    return { reply: refusedReply(request.requestId, 'refused', detail), commandKind: reading.command.kind };
  }
  try {
    const applied = ControlService.apply(verdict.command, change);
    return {
      reply: {
        hatchFormatVersion: HATCH_FORMAT_VERSION, requestId: request.requestId, outcome: applied.outcome, ticketIds: ticketIdsOf(applied.result)
      },
      commandKind: reading.command.kind,
    };
  } catch (thrown) {
    return { reply: replyOfRefusal(request.requestId, thrown), commandKind: reading.command.kind };
  }
}

/**
 * Inside the hold, before any Watcher event: each request of a job still on the board and readable is applied once, whatever its verdict,
 * and logged with its outcome. The replies are returned for the Overseer to write once the hold has committed.
 */
function applyPendingRequests(change: TrackerChange, repositoryRoot: string, pending: readonly PendingHatchRequest[]): HatchReplyToWrite[] {
  const replies: HatchReplyToWrite[] = [];
  for (const request of pending) {
    const job = change.board.jobById(request.jobId);
    if (job === undefined || !hatchIsReadable(job) || change.board.hatchRequestIsApplied(request.requestId)) continue;
    const { reply, commandKind } = replyOf(change, job, request);
    change.board.recordHatchApplied(job.id, { requestId: request.requestId, commandKind, outcome: reply.outcome }, change.at);
    replies.push({ hatchDirectory: hatchDirectoryOf(repositoryRoot, job.id), reply });
  }
  return replies;
}

function writeReplies(replies: readonly HatchReplyToWrite[]): void {
  for (const { hatchDirectory, reply } of replies) {
    writeFileAtomically(hatchReplyFilePathOf(hatchDirectory, reply.requestId), `${JSON.stringify(reply, null, 2)}\n`);
  }
}

export const HatchInbox = Object.freeze({
  hatchDirectoryOf, pendingRequestsOf, applyPendingRequests, writeReplies
});
