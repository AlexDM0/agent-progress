/** Reads the board without a lock into the Overseer's `BoardState`, its `status --json --full` part built as `status` builds it. */
import { join } from 'node:path';

import { UsageMarkerFile } from '../../../src/adapters/usage-marker/UsageMarkerFile.ts';
import { LogUtil }         from '../../../src/adapters/utils/LogUtil.ts';
import { predictMerges }   from '../../../src/lib/git/MergeTree.ts';
import { readingBoardOf }  from '../../../src/lib/tracker-model/ReadingBoard.ts';
import {
  BoardStateAssembly,
  type BoardState,
  type MergeForecasting,
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
  context:   CommandContext;
  workspace: Workspace;
  notices:   () => readonly unknown[];
  /** Everything but `paused`, which the board's stored drain flag says. */
  overseer:  () => Omit<OverseerFacts, 'paused'>;
  /** The branch the main checkout lands on; without it the merge queue's targets go unpredicted and empty. */
  mainLine?: string;
}

/** The merge slots' own target rule and git's predictions, read in the main checkout as the slots read them. */
function mergeForecastingIn(repositoryRoot: string, mainLine: string): MergeForecasting {
  const branchOf = (ticketId: string): string => `ticket-${ticketId}`;
  return {
    targetOf:    (ticket) => (ticket.group === undefined || ticket.releasesGroup === true ? mainLine : `${GROUP_TARGET_PREFIX}${ticket.group}`),
    forecastsOf: (target, ticketIds) => {
      const predictions = predictMerges(repositoryRoot, ticketIds.map((ticketId) => ({ target, branch: branchOf(ticketId) })));
      const againstTarget = Object.fromEntries(ticketIds.map((ticketId, index) => {
        const prediction = predictions[index] ?? { verdict: 'prediction-failed', reason: '' };
        const conflictedFiles = prediction.verdict === 'clean' ? [] : prediction.verdict === 'conflicting' ? prediction.conflictedFiles : null;
        return [ticketId, { forecast: prediction.verdict, conflictedFiles }];
      }));
      const cleanTicketIds = ticketIds.filter((ticketId) => againstTarget[ticketId]?.forecast === 'clean');
      const pairs = ticketIds.flatMap((ticketId) => cleanTicketIds
        .filter((cleanTicketId) => cleanTicketId !== ticketId && !(cleanTicketIds.includes(ticketId) && cleanTicketId < ticketId))
        .map((cleanTicketId) => [ticketId, cleanTicketId] as const));
      const pairPredictions = predictMerges(repositoryRoot, pairs.map(([first, second]) => ({ target: branchOf(second), branch: branchOf(first) })));
      return { againstTarget, pairwiseConflicts: pairs.filter((_pair, index) => pairPredictions[index]?.verdict !== 'clean') };
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
    statusDocument:   fullDocumentOf(progress, storedLog.records.map(LogUtil.wordedEntryOf), board, false),
    board,
    progress,
    tickets:          listing.tickets,
    epics:            epicListing.epics,
    drafts:           draftListing.drafts,
    logRecords:       storedLog.records,
    generatedAt:      context.now(),
    renderMarkdown:   context.renderState.markdownRenderer.renderMarkdown,
    liveFactsOf:      (job) => JobLiveFactsReader.liveFactsOf(workspace.trackerDirectory, job, (line) => context.agentAdapter.eventsOf(line)),
    notices:          source.notices(),
    overseer:         { ...source.overseer(), paused: board.dispatcherState() === 'stopped' },
    usage:            usageOf(context),
    mergeForecasting: source.mainLine === undefined ? null : mergeForecastingIn(workspace.rootDirectory, source.mainLine),
  });
  return { state, project: progress.project, readyTicketIds: board.readyTicketEntries().map((ready) => ready.id) };
}
