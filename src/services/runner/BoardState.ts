/**
 * The Overseer's `BoardState` document, `GET /api/state` and the `board` event: the `status --json` document plus the page's islands,
 * every job with its live facts, the notices, the merge queue, the Overseer and usage, all from one reading Board. agent-dashboard's
 * subset, `summaryVersion: 1`, is derived from it.
 */
import type { Draft }                                                from '../../lib/tracker-model/@types/Draft.ts';
import type { Epic }                                                 from '../../lib/tracker-model/@types/Epic.ts';
import type { Job }                                                  from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                                            from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                                               from '../../lib/tracker-model/@types/Ticket.ts';
import type { TicketPriority }                                       from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                                      from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { Board }                                                from '../../lib/tracker-model/Board.ts';
import type { MergeTargetOf }                                        from '../../lib/tracker-model/MergeSlotClaims.ts';
import { MergeQueueUtil, type MergeForecast, type PairwiseConflict } from '../../lib/tracker-model/utils/MergeQueueUtil.ts';
import { boardFactsOf }                                              from '../render/BoardFacts.ts';
import { assemblePagePayload, type AssembledPagePayload }            from '../render/PagePayloadAssembly.ts';
import type { JobLiveFacts }                                         from './JobLiveFactsReader.ts';

export type OverseerRuntimeState = 'serving' | 'held-by-install-change' | 'handing-over' | 'down';

export interface OverseerFacts {
  state:           OverseerRuntimeState;
  paused:          boolean;
  url:             string | null;
  generation:      number | null;
  codeVersion:     string;
  installVersion:  number;
  /** The last handover that failed while this Overseer kept driving; `null` when none did. */
  handoverWarning: unknown;
}

export interface UsageFacts {
  /** From the machine's usage marker: no launch happens before it; `null` when no limit was hit. */
  resetsAt: string | null;
  window:   string | null;
}

/** One waiting candidate on a target, in the merge queue's order. */
export interface MergeQueueEntry {
  ticketId:        string;
  priority:        TicketPriority;
  againstTarget:   MergeForecast;
  /** Empty when clean, the files git named when conflicting, `null` when the prediction failed. */
  conflictedFiles: string[] | null;
  /** The other clean candidates whose merge this one's would conflict with. */
  conflictsCaused: number;
}

/** One merge target: its Airlock holder, its waiting candidates in order, and the decisions its landings wait on. */
export interface MergeTargetFacts {
  target:                 string;
  holder:                 { jobId: string; ticketIds: string[]; phase: string } | null;
  order:                  MergeQueueEntry[];
  pairwiseConflicts:      PairwiseConflict[];
  targetMovedDecisionIds: string[];
}

/** git's predictions for a target's waiting candidates, which the Overseer reads from the repository. */
export interface MergeForecasts {
  againstTarget:     Readonly<Record<string, { forecast: MergeForecast; conflictedFiles: string[] | null }>>;
  pairwiseConflicts: PairwiseConflict[];
}

export interface MergeForecasting {
  targetOf:    MergeTargetOf;
  forecastsOf: (target: string, ticketIds: readonly string[]) => MergeForecasts;
}

export interface MergeQueueFacts {
  /** In-review tickets queued for a merge, in board order. */
  queuedTicketIds: string[];
  /** Each merge or refresh job holding its target's slot. */
  slots:           { jobId: string; target: string; phase: string }[];
  /** Every target with a slot holder or a queued ticket; empty when the reading carries no forecasting. */
  targets:         MergeTargetFacts[];
}

/** The live facts plus the DrivePass's in-memory count of quiet sweeps, which no event log holds. */
export type JobLiveFactsWithSilence = JobLiveFacts & { silentSweeps: number };

export type JobWithLiveFacts = Readonly<Job> & { live: JobLiveFactsWithSilence };

export interface BoardStateReading {
  /** The `status --json --full` document, built by the command surface from the same Board. */
  statusDocument:   object;
  board:            Board;
  progress:         TrackerProgress;
  tickets:          readonly Ticket[];
  epics:            readonly Epic[];
  drafts:           readonly Draft[];
  logRecords:       readonly LogRecord[];
  generatedAt:      Date;
  renderMarkdown:   (markdown: string) => string;
  liveFactsOf:      (job: Readonly<Job>) => JobLiveFactsWithSilence;
  notices:          readonly unknown[];
  overseer:         OverseerFacts;
  usage:            UsageFacts;
  /** `null` leaves the merge queue's targets empty, as a reading without a repository to predict in does. */
  mergeForecasting: MergeForecasting | null;
}

export interface BoardState {
  [statusField: string]: unknown;
  page:                  AssembledPagePayload;
  jobs:                  JobWithLiveFacts[];
  decisions:             unknown[];
  incidents:             unknown[];
  notices:               unknown[];
  mergeQueue:            MergeQueueFacts;
  overseer:              OverseerFacts;
  usage:                 UsageFacts;
  /** What an open decision or incident leaves behind once it is settled, and the sessions the Bridge shows after they end: see `questionHistoryOf`. */
  questionHistory:       LogRecord[];
}

export interface BoardSummary {
  summaryVersion:      1;
  project:             string;
  overseer:            { state: OverseerRuntimeState; paused: boolean; url: string | null };
  ticketCountByStatus: unknown;
  readyTicketIds:      string[];
  jobs:                { id: string; kind: string; ticketIds: string[]; state: string; role: string | null; tokens: number }[];
  openDecisions:       number;
  openIncidents:       number;
  usage:               UsageFacts;
}

function mergeTargetOf(board: Board, target: string, forecasting: MergeForecasting): MergeTargetFacts {
  const candidates = board.mergeCandidatesOf(target, forecasting.targetOf);
  const forecasts  = forecasting.forecastsOf(target, candidates.map((candidate) => candidate.ticketId));
  const predictionOf = (ticketId: string) => (Object.hasOwn(forecasts.againstTarget, ticketId) ? forecasts.againstTarget[ticketId] : undefined);
  const queueCandidates = candidates.map((candidate) => ({
    ticketId:          candidate.ticketId,
    priority:          candidate.priority,
    againstTarget:     predictionOf(candidate.ticketId)?.forecast ?? 'prediction-failed',
    queuedLogPosition: candidate.readiness,
  }));
  const holder = board.jobs().find((job) => job.slot?.target === target);
  const ticketTargetIs = (ticketId: string): boolean => {
    const ticket = board.ticketByReference(ticketId);
    return ticket !== undefined && forecasting.targetOf(ticket.frontmatter) === target;
  };
  return {
    target,
    holder: holder?.slot === undefined ? null : { jobId: holder.id, ticketIds: [...holder.ticketIds], phase: holder.slot.phase },
    order:  MergeQueueUtil.orderOf(queueCandidates, forecasts.pairwiseConflicts).map((candidate) => ({
      ticketId:        candidate.ticketId,
      priority:        candidate.priority,
      againstTarget:   candidate.againstTarget,
      conflictedFiles: predictionOf(candidate.ticketId)?.conflictedFiles ?? null,
      conflictsCaused: MergeQueueUtil.conflictsCausedBy(candidate, queueCandidates, forecasts.pairwiseConflicts),
    })),
    pairwiseConflicts:      [...forecasts.pairwiseConflicts],
    targetMovedDecisionIds: board.decisions()
      .filter((decision) => decision.kind === 'target-moved' && decision.ticketIds.some(ticketTargetIs))
      .map((decision) => decision.id),
  };
}

function mergeQueueOf(board: Board, forecasting: MergeForecasting | null): MergeQueueFacts {
  const queuedTicketIds = board.tickets().map((ticket) => ticket.frontmatter.id).filter((ticketId) => board.ticketIsMergeQueued(ticketId));
  const slots = board.jobs().flatMap((job) => (job.slot === undefined ? [] : [{ jobId: job.id, target: job.slot.target, phase: job.slot.phase }]));
  if (forecasting === null) return { queuedTicketIds, slots, targets: [] };
  const queuedTargets = queuedTicketIds.flatMap((ticketId) => {
    const ticket = board.ticketByReference(ticketId);
    return ticket === undefined ? [] : [forecasting.targetOf(ticket.frontmatter)];
  });
  const targets = [...new Set([...slots.map((slot) => slot.target), ...queuedTargets])].sort();
  return { queuedTicketIds, slots, targets: targets.map((target) => mergeTargetOf(board, target, forecasting)) };
}

const SESSION_JOB_KINDS: ReadonlySet<string> = new Set(['orchestrator', 'product-owner']);

/**
 * The log records the Bridge's Questions, Assistant and Intake views read: every decision and incident record, every `ticket-triaged`, and
 * every record of an orchestrator or product-owner job, since an answered decision, a handled incident and a closed intake leave the board.
 */
function questionHistoryOf(logRecords: readonly LogRecord[]): LogRecord[] {
  const sessionJobIds = new Set(logRecords.flatMap((record) => (record.kind === 'job-launched' && SESSION_JOB_KINDS.has(record.fields.kind) ? [record.jobId] : [])));
  return logRecords.filter((record) => {
    if ('decisionId' in record || 'incidentId' in record || record.kind === 'ticket-triaged') return true;
    return 'jobId' in record && sessionJobIds.has(record.jobId);
  });
}

function boardStateOf(reading: BoardStateReading): BoardState {
  const { board } = reading;
  const page = assemblePagePayload({
    progress:          reading.progress,
    logRecords:        reading.logRecords,
    tickets:           reading.tickets,
    epics:             reading.epics,
    pageScriptFailure: null,
    generatedAt:       reading.generatedAt,
    concurrency:       board.concurrency(),
    boardFacts:        boardFactsOf(board),
    draftRequests:     reading.drafts.map((draft) => ({ id: draft.id, request: draft.request })),
    renderMarkdown:    reading.renderMarkdown,
  });
  return {
    ...reading.statusDocument,
    page,
    jobs:            board.jobs().map((job) => ({ ...job, live: reading.liveFactsOf(job) })),
    decisions:       [...board.decisions()],
    incidents:       [...board.incidents()],
    notices:         [...reading.notices],
    mergeQueue:      mergeQueueOf(board, reading.mergeForecasting),
    overseer:        reading.overseer,
    usage:           reading.usage,
    questionHistory: questionHistoryOf(reading.logRecords),
  };
}

function summaryOf(state: BoardState, project: string, readyTicketIds: readonly string[]): BoardSummary {
  return {
    summaryVersion:      1,
    project,
    overseer:            { state: state.overseer.state, paused: state.overseer.paused, url: state.overseer.url },
    ticketCountByStatus: state['ticketCountByStatus'],
    readyTicketIds:      [...readyTicketIds],
    jobs:                state.jobs.map((job) => ({
      id: job.id, kind: job.kind, ticketIds: [...job.ticketIds], state: job.state, role: job.role, tokens: job.live.tokens
    })),
    openDecisions: state.decisions.length,
    openIncidents: state.incidents.length,
    usage:         state.usage,
  };
}

export const BoardStateAssembly = Object.freeze({
  boardStateOf, summaryOf, questionHistoryOf, mergeQueueOf
});
