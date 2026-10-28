/**
 * The runner's side of the relay: every job's folder `<W>/relay/<J>/` is mapped to its job record, which alone gives the request its job
 * and role; a folder whose job is neither live nor awaiting verification is not read. Each pending request is applied in the DrivePass
 * hold through the role policy and `ControlService`, its id logged on a `relay-applied` record so a replay never applies it twice, and
 * its reply written once the hold committed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';

import type { RelayReply }                               from '../../adapters/relay/@types/RelayFormat.ts';
import { relayReplyFilePathOf, relayRequestFilePathOf }  from '../../adapters/relay/RelayFolder.ts';
import { RelayFormatUtil }                               from '../../adapters/relay/utils/RelayFormatUtil.ts';
import { writeFileAtomically }                           from '../../lib/atomic-file/AtomicFile.ts';
import type { Job, JobState }                            from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                                    from '../../lib/tracker-model/Board.ts';
import { BoardRefusal }                                  from '../../lib/tracker-model/BoardRefusal.ts';
import { OperationRefusal, type OperationRefusalDetail } from '../../shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                 from '../../shared/constants/ProductNames.ts';
import { ControlService }                                from '../control/ControlService.ts';
import { RoleCommandPolicy, type RelayingJob }           from '../control/RoleCommandPolicy.ts';
import type { TrackerChange }                            from '../tracker/TrackerPipeline.ts';

export interface PendingRelayRequest {
  jobId:     string;
  requestId: string;
  text:      string;
}

export interface RelayReplyToWrite {
  relayDirectory: string;
  reply:          RelayReply;
}

/** A job past verification has nothing a session could still be waiting on, and an ended one has left the board. */
const RELAY_READABLE_STATES: ReadonlySet<JobState> = new Set([
  'launching', 'preparing', 'running', 'waiting-for-answer', 'interrupted', 'awaiting-answer', 'verifying', 'stopping',
]);

const REQUEST_FILE_PATTERN = /^(.+)\.json$/;
const RELAY_FORMAT_VERSION = 1;

function relayDirectoryOf(repositoryRoot: string, jobId: string): string {
  return join(repositoryRoot, PRODUCT_NAMES.WORKTREES_FOLDER, 'relay', jobId);
}

function relayIsReadable(job: Readonly<Job> | undefined): boolean {
  return job !== undefined && RELAY_READABLE_STATES.has(job.state);
}

function requestIdsIn(relayDirectory: string): string[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(join(relayDirectory, 'requests'));
  } catch {
    return [];
  }
  return fileNames.map((fileName) => REQUEST_FILE_PATTERN.exec(fileName)?.[1]).filter((requestId): requestId is string => requestId !== undefined).sort();
}

function replyExists(relayDirectory: string, requestId: string): boolean {
  try {
    readFileSync(relayReplyFilePathOf(relayDirectory, requestId));
    return true;
  } catch {
    return false;
  }
}

/** Outside the lock: every unanswered request of each job whose folder may be read, in request-id order within a job. */
function pendingRequestsOf(repositoryRoot: string, jobs: readonly Readonly<Job>[]): PendingRelayRequest[] {
  return jobs.filter(relayIsReadable).flatMap((job) => {
    const relayDirectory = relayDirectoryOf(repositoryRoot, job.id);
    return requestIdsIn(relayDirectory)
      .filter((requestId) => !replyExists(relayDirectory, requestId))
      .flatMap((requestId) => {
        try {
          return [{ jobId: job.id, requestId, text: readFileSync(relayRequestFilePathOf(relayDirectory, requestId), 'utf8') }];
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

function refusedReply(requestId: string, status: OperationRefusal['status'], detail: OperationRefusalDetail): RelayReply {
  return {
    relayFormatVersion: RELAY_FORMAT_VERSION, requestId, outcome: 'refused', status, detail
  };
}

function replyOfRefusal(requestId: string, thrown: unknown): RelayReply {
  if (thrown instanceof BoardRefusal) return refusedReply(requestId, 'refused', { kind: 'board-refusal', boardRefusal: thrown.detail });
  if (thrown instanceof OperationRefusal && thrown.detail !== null) return refusedReply(requestId, thrown.status, thrown.detail);
  throw thrown;
}

function replyOf(change: TrackerChange, job: Readonly<Job>, request: PendingRelayRequest): { reply: RelayReply; commandKind: string } {
  const reading = RelayFormatUtil.requestReadingOf(request.text);
  if (reading.verdict === 'refused') {
    const detail: OperationRefusalDetail = reading.reason === 'relay-identity-mismatch'
      ? { kind: 'relay-identity-mismatch', requestId: request.requestId, jobId: job.id }
      : { kind: 'malformed-relay-request', requestId: request.requestId };
    return { reply: refusedReply(request.requestId, 'refused', detail), commandKind: 'unread' };
  }
  // The file's name is the id the session waits on; a body naming another is a request copied from elsewhere.
  if (reading.requestId !== request.requestId) {
    const detail: OperationRefusalDetail = { kind: 'relay-identity-mismatch', requestId: request.requestId, jobId: job.id };
    return { reply: refusedReply(request.requestId, 'refused', detail), commandKind: reading.command.kind };
  }
  const verdict = RoleCommandPolicy.verdictOf(relayingJobOf(change.board, job), reading.command);
  if (verdict.verdict === 'refused') {
    const detail: OperationRefusalDetail = { kind: 'role-command-refused', reason: verdict.reason, commandKind: reading.command.kind };
    return { reply: refusedReply(request.requestId, 'refused', detail), commandKind: reading.command.kind };
  }
  try {
    const applied = ControlService.apply(verdict.command, change);
    return {
      reply: {
        relayFormatVersion: RELAY_FORMAT_VERSION, requestId: request.requestId, outcome: applied.outcome, ticketIds: ticketIdsOf(applied.result)
      },
      commandKind: reading.command.kind,
    };
  } catch (thrown) {
    return { reply: replyOfRefusal(request.requestId, thrown), commandKind: reading.command.kind };
  }
}

/**
 * Inside the hold, before any host event: each request of a job still on the board and readable is applied once, whatever its verdict,
 * and logged with its outcome. The replies are returned for the runner to write once the hold has committed.
 */
function applyPendingRequests(change: TrackerChange, repositoryRoot: string, pending: readonly PendingRelayRequest[]): RelayReplyToWrite[] {
  const replies: RelayReplyToWrite[] = [];
  for (const request of pending) {
    const job = change.board.jobById(request.jobId);
    if (job === undefined || !relayIsReadable(job) || change.board.relayRequestIsApplied(request.requestId)) continue;
    const { reply, commandKind } = replyOf(change, job, request);
    change.board.recordRelayApplied(job.id, { requestId: request.requestId, commandKind, outcome: reply.outcome }, change.at);
    replies.push({ relayDirectory: relayDirectoryOf(repositoryRoot, job.id), reply });
  }
  return replies;
}

function writeReplies(replies: readonly RelayReplyToWrite[]): void {
  for (const { relayDirectory, reply } of replies) {
    writeFileAtomically(relayReplyFilePathOf(relayDirectory, reply.requestId), `${JSON.stringify(reply, null, 2)}\n`);
  }
}

export const RelayInbox = Object.freeze({
  relayDirectoryOf, pendingRequestsOf, applyPendingRequests, writeReplies
});
