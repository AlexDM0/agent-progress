/**
 * What a fresh Assistant (the Overseer's `assistant` job, design section 8.3) boots with: its model and effort beside every other role's,
 * and the board it starts from, since it is booted clean and the board is its memory. Its first message carries every open incident, which
 * is its first delivery turn.
 */

import type { AgentEffort } from '../../lib/agent-launch/AgentLaunchRequest.ts';
import type { Incident }    from '../../lib/tracker-model/@types/Incident.ts';
import type { Job }         from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }   from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }       from '../../lib/tracker-model/Board.ts';
import {
  ASSISTANT_EFFORT,
  ASSISTANT_HISTORY_RECORDS,
  ASSISTANT_MODEL,
  WORKER_EFFORT,
  WORKER_MODEL
} from '../../shared/constants/OverseerLimits.ts';

export interface LaunchSettings {
  model:  string;
  effort: AgentEffort;
}

export interface AssistantHistoryRecord {
  at:         string;
  kind:       string;
  incidentId: string;
  fields:     string;
}

export interface BoardSummary {
  ticketCountByStatus: Readonly<Record<string, number>>;
  liveJobs:            readonly { id: string; kind: string; state: string; ticketIds: readonly string[] }[];
  openDecisionCount:   number;
}

/** The facts an Assistant's first message is worded from: the incidents it is delivered, the newest incident records, and the board. */
export interface AssistantFacts {
  incidents: readonly Readonly<Incident>[];
  history:   readonly AssistantHistoryRecord[];
  summary:   BoardSummary;
}

/** The first message is chat 1 of every Assistant session; each later chat is numbered on from it. */
export const FIRST_CHAT_SEQUENCE = 1;

const ASSISTANT_JOB_KIND = 'assistant';

function isAssistantJob(job: Readonly<Job>): boolean {
  return job.kind === ASSISTANT_JOB_KIND;
}

function launchSettingsOf(job: Readonly<Job>): LaunchSettings {
  return isAssistantJob(job) ? { model: ASSISTANT_MODEL, effort: ASSISTANT_EFFORT } : { model: WORKER_MODEL, effort: WORKER_EFFORT };
}

function incidentHistoryOf(logRecords: readonly LogRecord[]): AssistantHistoryRecord[] {
  return logRecords
    .flatMap((record) => ('incidentId' in record ? [{
      at: record.at, kind: record.kind, incidentId: record.incidentId, fields: JSON.stringify(record.fields)
    }] : []))
    .slice(-ASSISTANT_HISTORY_RECORDS);
}

function boardSummaryOf(board: Board): BoardSummary {
  const ticketCountByStatus: Record<string, number> = {};
  for (const ticket of board.tickets()) ticketCountByStatus[ticket.frontmatter.status] = (ticketCountByStatus[ticket.frontmatter.status] ?? 0) + 1;
  return {
    ticketCountByStatus,
    liveJobs: board.jobs().map((job) => ({
      id: job.id, kind: job.kind, state: job.state, ticketIds: job.ticketIds
    })),
    openDecisionCount: board.decisions().length,
  };
}

/** Run in the hold that boots it, after the lifecycle: every open incident not yet delivered goes out in the fresh session's first message. */
function deliverOpenIncidentsAtBoot(board: Board, jobIdsBeforeTheLifecycle: ReadonlySet<string>): void {
  const booting = board.jobs().filter((job) => isAssistantJob(job) && !jobIdsBeforeTheLifecycle.has(job.id));
  for (const job of booting) {
    for (const incident of board.incidents().filter((open) => open.deliveredInTurn === null)) {
      board.markIncidentDelivered(incident.id, { jobId: job.id, chatSequence: FIRST_CHAT_SEQUENCE });
    }
  }
}

/** `null` for every job but an Assistant. */
function assistantFactsOf(board: Board, job: Readonly<Job>): AssistantFacts | null {
  if (!isAssistantJob(job)) return null;
  return {
    incidents: board.incidents().filter((incident) => incident.deliveredInTurn?.jobId === job.id && incident.deliveredInTurn.chatSequence === FIRST_CHAT_SEQUENCE),
    history:   incidentHistoryOf(board.logRecordsSoFar()),
    summary:   boardSummaryOf(board),
  };
}

export const AssistantBoot = Object.freeze({
  isAssistantJob,
  launchSettingsOf,
  deliverOpenIncidentsAtBoot,
  assistantFactsOf,
});
