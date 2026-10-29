/**
 * The Overseer's `BoardState` document, `GET /api/state` and the `board` event: the `status --json` document plus the page's islands,
 * every job with its live facts, the notices, the merge queue, the Overseer and usage, all from one reading Board. agent-dashboard's
 * subset, `summaryVersion: 1`, is derived from it.
 */
import type { Draft }                                     from '../../lib/tracker-model/@types/Draft.ts';
import type { Epic }                                      from '../../lib/tracker-model/@types/Epic.ts';
import type { Job }                                       from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                                    from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                           from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { Board }                                     from '../../lib/tracker-model/Board.ts';
import { boardFactsOf }                                   from '../render/BoardFacts.ts';
import { assemblePagePayload, type AssembledPagePayload } from '../render/PagePayloadAssembly.ts';
import type { JobLiveFacts }                              from './JobLiveFactsReader.ts';

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

export interface MergeQueueFacts {
  /** In-review tickets queued for a merge, in board order. */
  queuedTicketIds: string[];
  /** Each merge or refresh job holding its target's slot. */
  slots:           { jobId: string; target: string; phase: string }[];
}

/** The live facts plus the DrivePass's in-memory count of quiet sweeps, which no event log holds. */
export type JobLiveFactsWithSilence = JobLiveFacts & { silentSweeps: number };

export type JobWithLiveFacts = Readonly<Job> & { live: JobLiveFactsWithSilence };

export interface BoardStateReading {
  /** The `status --json --full` document, built by the command surface from the same Board. */
  statusDocument: object;
  board:          Board;
  progress:       TrackerProgress;
  tickets:        readonly Ticket[];
  epics:          readonly Epic[];
  drafts:         readonly Draft[];
  logRecords:     readonly LogRecord[];
  generatedAt:    Date;
  renderMarkdown: (markdown: string) => string;
  liveFactsOf:    (job: Readonly<Job>) => JobLiveFactsWithSilence;
  notices:        readonly unknown[];
  overseer:       OverseerFacts;
  usage:          UsageFacts;
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

function mergeQueueOf(board: Board): MergeQueueFacts {
  return {
    queuedTicketIds: board.tickets().map((ticket) => ticket.frontmatter.id).filter((ticketId) => board.ticketIsMergeQueued(ticketId)),
    slots:           board.jobs().flatMap((job) => (job.slot === undefined ? [] : [{ jobId: job.id, target: job.slot.target, phase: job.slot.phase }])),
  };
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
    jobs:       board.jobs().map((job) => ({ ...job, live: reading.liveFactsOf(job) })),
    decisions:  [...board.decisions()],
    incidents:  [...board.incidents()],
    notices:    [...reading.notices],
    mergeQueue: mergeQueueOf(board),
    overseer:   reading.overseer,
    usage:      reading.usage,
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

export const BoardStateAssembly = Object.freeze({ boardStateOf, summaryOf });
