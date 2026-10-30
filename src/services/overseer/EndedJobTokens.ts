/**
 * When a job ends, its session's tokens go to its tickets' rows: read from every Watcher instance's event log, summed by `TokenCrediting`,
 * logged as one `agent-stopped` record keyed by the job id and added to the rows, a review job's to its ticket's newest review bar.
 */
import type { AgentAdapter }                 from '../../lib/agent-launch/AgentAdapter.ts';
import type { TokenCredit }                  from '../../lib/tracker-model/@types/BoardChanges.ts';
import type { Job }                          from '../../lib/tracker-model/@types/Job.ts';
import type { AgentUsage, LogRecord }        from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }                        from '../../lib/tracker-model/Board.ts';
import { FIRST_WATCHER_INSTANCE }            from '../../lib/tracker-model/constants/JobStates.ts';
import { type CreditedTurn, TokenCrediting } from '../lifecycle/TokenCrediting.ts';
import { WatcherFleet }                      from './WatcherFleet.ts';

export interface EndedJobTokensContext {
  trackerDirectory: string;
  agentAdapter:     AgentAdapter;
}

/** What crediting reads of a job, so a job the log ended can be rebuilt from its records. */
interface EndedJob {
  readonly id:              string;
  readonly kind:            Job['kind'];
  readonly ticketIds:       readonly string[];
  readonly watcherInstance: number;
}

function creditedTurnsOf(context: EndedJobTokensContext, job: EndedJob): CreditedTurn[] {
  const jobFolder = WatcherFleet.jobFolderOf(context.trackerDirectory, job.id);
  const turns: CreditedTurn[] = [];
  for (let instance = 1; instance <= job.watcherInstance; instance += 1) {
    const entries = WatcherFleet.eventsAfter(jobFolder, instance, 0);
    if (entries === 'malformed') continue;
    for (const entry of entries.filter((logged) => logged.origin === 'agent')) {
      for (const event of context.agentAdapter.eventsOf(entry.line)) {
        if (event.kind === 'assistant-turn') turns.push({ messageId: event.messageId, parentToolUseId: event.parentToolUseId, usage: event.usage });
      }
    }
  }
  return turns;
}

function endContextTokensOf(turns: readonly CreditedTurn[]): number {
  const lastUsage = turns.findLast((turn) => turn.parentToolUseId === null && turn.usage !== null)?.usage;
  return lastUsage === undefined || lastUsage === null ? 0 : lastUsage.inputTokens + lastUsage.cacheCreationInputTokens + lastUsage.cacheReadInputTokens;
}

function usageOf(job: EndedJob, turns: readonly CreditedTurn[]): AgentUsage {
  const { topLevel, total } = TokenCrediting.sessionTokensOf(turns);
  return {
    agentId:              job.id,
    agentType:            job.kind,
    apiCallCount:         topLevel.calls,
    endContextTokens:     endContextTokensOf(turns),
    totalInputTokens:     total.inputTokens + total.cacheCreationInputTokens + total.cacheReadInputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens,
    outputTokens:         total.outputTokens,
  };
}

/** A bundle's tokens are split evenly over its tickets, the remainder going to the first. */
function creditsOf(job: EndedJob, tokens: number): TokenCredit[] {
  const share = Math.floor(tokens / job.ticketIds.length);
  const remainder = tokens - (share * job.ticketIds.length);
  const target = job.kind === 'review' ? 'review' : 'ticket';
  return job.ticketIds.map((ticketId, i) => ({ target, ticketId, tokens: share + (i === 0 ? remainder : 0) }));
}

function creditEndedJob(board: Board, context: EndedJobTokensContext, job: EndedJob, at: string): void {
  const turns = creditedTurnsOf(context, job);
  if (turns.length === 0) return;
  const usage = usageOf(job, turns);
  const tokensStillToCredit = TokenCrediting.tokensStillToCreditOf(usage, board.logRecordsSoFar());
  board.recordAgentStop(usage, tokensStillToCredit === 0 ? [] : creditsOf(job, tokensStillToCredit), at);
}

/** Credits each ticket job of `jobsAtTheHoldStart` the hold took off the board; an ended job leaves the board in the hold that ends it. */
function creditJobsEndedInTheHold(board: Board, context: EndedJobTokensContext, jobsAtTheHoldStart: readonly Readonly<Job>[], at: string): void {
  const jobIdsStillOnTheBoard = new Set(board.jobs().map((job) => job.id));
  for (const job of jobsAtTheHoldStart) {
    if (!jobIdsStillOnTheBoard.has(job.id) && job.ticketIds.length > 0) creditEndedJob(board, context, job, at);
  }
}

function highestWatcherInstanceOf(logRecords: readonly LogRecord[], jobId: string): number {
  return logRecords.reduce((highest, record) => (
    (record.kind === 'job-interrupted' || record.kind === 'job-resumed' || record.kind === 'job-reopened') && record.jobId === jobId
      ? Math.max(highest, record.fields.watcherInstance)
      : highest
  ), FIRST_WATCHER_INSTANCE);
}

/**
 * Credits every ticket job the log records as ended and not yet credited (no `agent-stopped` record), rebuilt from its `job-launched`
 * record, whichever hold ended it: this one, or a CLI control's hold of its own. Answers the job ids it looked at, which the caller skips
 * after, since a job with no turns logs nothing.
 */
function creditJobsTheLogEndedUncredited(board: Board, context: EndedJobTokensContext, jobIdsAlreadyExamined: ReadonlySet<string>, at: string): string[] {
  const logRecords = board.logRecordsSoFar();
  const creditedJobIds = new Set(logRecords.flatMap((record) => (record.kind === 'agent-stopped' ? [record.fields.agentId] : [])));
  const endedJobIds = new Set(logRecords.flatMap((record) => (record.kind === 'job-ended' ? [record.jobId] : [])));
  const examinedJobIds: string[] = [];
  for (const record of logRecords) {
    if (record.kind !== 'job-launched' || record.fields.ticketIds.length === 0) continue;
    const { jobId } = record;
    if (!endedJobIds.has(jobId) || creditedJobIds.has(jobId) || jobIdsAlreadyExamined.has(jobId)) continue;
    const job = {
      id: jobId, kind: record.fields.kind, ticketIds: record.fields.ticketIds, watcherInstance: highestWatcherInstanceOf(logRecords, jobId)
    };
    creditEndedJob(board, context, job, at);
    examinedJobIds.push(jobId);
  }
  return examinedJobIds;
}

export const EndedJobTokens = Object.freeze({ creditJobsEndedInTheHold, creditJobsTheLogEndedUncredited, creditsOf });
