/** Reads the board without a lock into the Overseer's `BoardState`, its `status --json --full` part built as `status` builds it. */
import { join } from 'node:path';

import { UsageMarkerFile } from '../../../src/adapters/usage-marker/UsageMarkerFile.ts';
import { LogUtil }         from '../../../src/adapters/utils/LogUtil.ts';
import { GitProcess }      from '../../../src/lib/git/GitProcess.ts';
import { predictMerges }   from '../../../src/lib/git/MergeTree.ts';
import { readingBoardOf }  from '../../../src/lib/tracker-model/ReadingBoard.ts';
import {
  BoardStateAssembly,
  type BoardState,
  type MergeForecasting,
  type MergeForecasts,
  type OverseerFacts,
  type UsageFacts
} from '../../../src/services/runner/BoardState.ts';
import { GROUP_TARGET_PREFIX } from '../../../src/services/runner/DrivePass.ts';
import { JobLiveFactsReader }  from '../../../src/services/runner/JobLiveFactsReader.ts';
import { requireTracker }      from '../../../src/services/tracker/TrackerReader.ts';
import type { Workspace }      from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }       from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext } from '../../CommandContext.ts';
import { fullDocumentOf }      from '../../StatusDocuments.ts';

export interface BoardStateSource {
  context:             CommandContext;
  workspace:           Workspace;
  notices:             () => readonly unknown[];
  /** Everything but `paused`, which the board's stored drain flag says. */
  overseer:            () => Omit<OverseerFacts, 'paused'>;
  /** The running DrivePass's count; absent while none runs, when every job reads 0. */
  silentSweepsOf?:     (jobId: string) => number;
  /** The branch the main checkout lands on; without it the merge queue's targets go unpredicted and empty. */
  mainLine?:           string;
  /** Held across reads, so a publish over unmoved branches reuses the last forecasts; without it every read predicts afresh. */
  mergeForecastCache?: MergeForecastCache;
}

/** One target's last forecasts, kept while its tip and every candidate's tip stay where they were. */
export interface MergeForecastCache {
  forecastsOf: (target: string, tipSet: string, forecast: () => MergeForecasts) => MergeForecasts;
}

export function createMergeForecastCache(): MergeForecastCache {
  const lastForecastsByTarget = new Map<string, { tipSet: string; forecasts: MergeForecasts }>();
  return {
    forecastsOf: (target, tipSet, forecast) => {
      const last = lastForecastsByTarget.get(target);
      if (last?.tipSet === tipSet) return last.forecasts;
      const forecasts = forecast();
      lastForecastsByTarget.set(target, { tipSet, forecasts });
      return forecasts;
    },
  };
}

/** The candidates in order with the commits the target and their branches point at; `null` when any of them does not resolve. */
function tipSetOf(repositoryRoot: string, target: string, ticketIds: readonly string[], branchOf: (ticketId: string) => string): string | null {
  const tipRun = GitProcess.run(repositoryRoot, ['rev-parse', '--end-of-options', target, ...ticketIds.map(branchOf)]);
  return GitProcess.succeeded(tipRun) ? `${ticketIds.join(' ')}\n${tipRun.standardOutput}` : null;
}

/**
 * The merge slots' own target rule and git's predictions, read in the main checkout as the slots read them. With a cache, a target
 * whose tip set has not moved since the last read runs no merge-tree; a tip set that does not resolve is never cached.
 */
export function mergeForecastingIn(
  repositoryRoot: string,
  mainLine: string,
  cache: MergeForecastCache | null,
  predict: typeof predictMerges = predictMerges,
): MergeForecasting {
  const branchOf = (ticketId: string): string => `ticket-${ticketId}`;
  const forecastsOf = (target: string, ticketIds: readonly string[]): MergeForecasts => {
    const predictions = predict(repositoryRoot, ticketIds.map((ticketId) => ({ target, branch: branchOf(ticketId) })));
    const againstTarget = Object.fromEntries(ticketIds.map((ticketId, index) => {
      const prediction = predictions[index] ?? { verdict: 'prediction-failed', reason: '' };
      const conflictedFiles = prediction.verdict === 'clean' ? [] : prediction.verdict === 'conflicting' ? prediction.conflictedFiles : null;
      return [ticketId, { forecast: prediction.verdict, conflictedFiles }];
    }));
    const cleanTicketIds = ticketIds.filter((ticketId) => againstTarget[ticketId]?.forecast === 'clean');
    const pairs = ticketIds.flatMap((ticketId) => cleanTicketIds
      .filter((cleanTicketId) => cleanTicketId !== ticketId && !(cleanTicketIds.includes(ticketId) && cleanTicketId < ticketId))
      .map((cleanTicketId) => [ticketId, cleanTicketId] as const));
    const pairPredictions = predict(repositoryRoot, pairs.map(([first, second]) => ({ target: branchOf(second), branch: branchOf(first) })));
    return { againstTarget, pairwiseConflicts: pairs.filter((_pair, index) => pairPredictions[index]?.verdict !== 'clean') };
  };
  return {
    targetOf:    (ticket) => (ticket.group === undefined || ticket.releasesGroup === true ? mainLine : `${GROUP_TARGET_PREFIX}${ticket.group}`),
    forecastsOf: (target, ticketIds) => {
      const tipSet = cache === null ? null : tipSetOf(repositoryRoot, target, ticketIds, branchOf);
      if (cache === null || tipSet === null) return forecastsOf(target, ticketIds);
      return cache.forecastsOf(target, tipSet, () => forecastsOf(target, ticketIds));
    },
  };
}

function usageOf(context: CommandContext): UsageFacts {
  const reading = UsageMarkerFile.read(join(context.homeDirectory, PRODUCT_NAMES.MONITOR_FOLDER));
  return reading.verdict === 'read' ? { resetsAt: reading.marker.resetsAt, window: reading.marker.window } : { resetsAt: null, window: null };
}

export function readBoardState(source: BoardStateSource): { state: BoardState; project: string; readyTicketIds: string[] } {
  const { context, workspace } = source;
  const {
    progress, storedLog, listing, epicListing, draftListing
  } = requireTracker(workspace);
  const board = readingBoardOf(progress, listing.tickets, epicListing.epics, draftListing.drafts, storedLog.records);
  const state = BoardStateAssembly.boardStateOf({
    statusDocument: fullDocumentOf(progress, storedLog.records.map(LogUtil.wordedEntryOf), board, false),
    board,
    progress,
    tickets:        listing.tickets,
    epics:          epicListing.epics,
    drafts:         draftListing.drafts,
    logRecords:     storedLog.records,
    generatedAt:    context.now(),
    renderMarkdown: context.renderState.markdownRenderer.renderMarkdown,
    liveFactsOf:    (job) => ({
      ...JobLiveFactsReader.liveFactsOf(workspace.trackerDirectory, job, (line) => context.agentAdapter.eventsOf(line)),
      silentSweeps: source.silentSweepsOf?.(job.id) ?? 0,
    }),
    notices:          source.notices(),
    overseer:         { ...source.overseer(), paused: board.dispatcherState() === 'stopped' },
    usage:            usageOf(context),
    mergeForecasting: source.mainLine === undefined ? null : mergeForecastingIn(workspace.rootDirectory, source.mainLine, source.mergeForecastCache ?? null),
  });
  return { state, project: progress.project, readyTicketIds: board.readyTicketEntries().map((ready) => ready.id) };
}
