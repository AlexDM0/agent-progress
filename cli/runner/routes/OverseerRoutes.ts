/**
 * The routes the Overseer's API serves, over the board, its job folders and agent-dashboard's server record: the state and summary read
 * fresh each request, a job's transcript and served files, the origins allowed to frame the Bridge, and the Bridge itself, whose HTML
 * import is the one place the command surface reaches `bridge/`, by path, for Bun to bundle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';

import bridgePage from '../../../bridge/index.html';

import { BoardStateAssembly }                             from '../../../src/services/runner/BoardState.ts';
import type { EventBroker }                               from '../../../src/services/runner/EventBroker.ts';
import { HostFleet }                                      from '../../../src/services/runner/HostFleet.ts';
import { JobTranscript }                                  from '../../../src/services/runner/JobTranscript.ts';
import type { RunnerRoutes, TranscriptFollower }          from '../../../src/services/runner/RunnerServer.ts';
import { readBoardState, type BoardStateSource }          from './BoardStateReader.ts';
import { answerControlCommand, type CommandRouteRequest } from './CommandRoute.ts';

export interface OverseerRouteRequest extends BoardStateSource, Omit<CommandRouteRequest, 'context'> {
  token:  () => string | null;
  broker: () => EventBroker | null;
}

const JOB_ID_PATTERN = /^J\d+$/;

/** agent-dashboard's own server record: its path is the dashboard's, never the product's naming constant. */
const DASHBOARD_SERVER_RECORD = ['.agent-progress-monitor', 'agent-dashboard', 'server.json'] as const;

function originOf(url: unknown): string[] {
  if (typeof url !== 'string') return [];
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}

/** With no readable record no origin may frame the Bridge. */
export function dashboardFrameOriginsOf(homeDirectory: string): string[] {
  try {
    const record: unknown = JSON.parse(readFileSync(join(homeDirectory, ...DASHBOARD_SERVER_RECORD), 'utf8'));
    if (typeof record !== 'object' || record === null) return [];
    const { url, boardOrigin } = record as { url?: unknown; boardOrigin?: unknown };
    return [...new Set([...originOf(url), ...originOf(boardOrigin)])];
  } catch {
    return [];
  }
}

function newestInstanceIn(jobFolder: string): number {
  let instance = 0;
  while (existsSync(join(jobFolder, `events-${instance + 1}.ndjson`))) instance += 1;
  return instance;
}

export function overseerRoutesOf(request: OverseerRouteRequest): RunnerRoutes {
  const { context, workspace } = request;
  const jobFolderOf = (jobId: string): string | null => {
    if (!JOB_ID_PATTERN.test(jobId)) return null;
    const jobFolder = HostFleet.jobFolderOf(workspace.trackerDirectory, jobId);
    return existsSync(jobFolder) ? jobFolder : null;
  };
  return {
    token:   request.token,
    command: (body) => answerControlCommand(body, { ...request, context }),
    onNudge: request.wake,
    state:   () => readBoardState(request).state,
    summary: () => {
      const { state, project, readyTicketIds } = readBoardState(request);
      return BoardStateAssembly.summaryOf(state, project, readyTicketIds);
    },
    events:       request.broker,
    transcriptOf: (jobId, after): TranscriptFollower | null => {
      const jobFolder = jobFolderOf(jobId);
      const startCursor = JobTranscript.cursorOf(after);
      if (jobFolder === null || startCursor === null) return null;
      let cursor = startCursor;
      return () => {
        const read = JobTranscript.entriesAfter(jobFolder, newestInstanceIn(jobFolder), cursor, (line) => context.agentAdapter.eventsOf(line));
        ({ cursor } = read);
        return read.entries;
      };
    },
    jobFileText: (jobId, fileName) => {
      const jobFolder = jobFolderOf(jobId);
      if (jobFolder === null) return null;
      try {
        return readFileSync(join(jobFolder, fileName), 'utf8');
      } catch {
        return null;
      }
    },
    frameOrigins: () => dashboardFrameOriginsOf(context.homeDirectory),
    page:         bridgePage,
  };
}
