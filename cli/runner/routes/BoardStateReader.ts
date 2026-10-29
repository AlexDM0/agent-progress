/** Reads the board without a lock into the Overseer's `BoardState`, its `status --json --full` part built as `status` builds it. */
import { join } from 'node:path';

import { UsageMarkerFile } from '../../../src/adapters/usage-marker/UsageMarkerFile.ts';
import { LogUtil }         from '../../../src/adapters/utils/LogUtil.ts';
import { readingBoardOf }  from '../../../src/lib/tracker-model/ReadingBoard.ts';
import {
  BoardStateAssembly,
  type BoardState,
  type OverseerFacts,
  type UsageFacts
} from '../../../src/services/runner/BoardState.ts';
import { JobLiveFactsReader }  from '../../../src/services/runner/JobLiveFactsReader.ts';
import { requireTracker }      from '../../../src/services/tracker/TrackerReader.ts';
import type { Workspace }      from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }       from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext } from '../../CommandContext.ts';
import { fullDocumentOf }      from '../../StatusDocuments.ts';

export interface BoardStateSource {
  context:         CommandContext;
  workspace:       Workspace;
  notices:         () => readonly unknown[];
  /** Everything but `paused`, which the board's stored drain flag says. */
  overseer:        () => Omit<OverseerFacts, 'paused'>;
  /** The running DrivePass's count; absent while none runs, when every job reads 0. */
  silentSweepsOf?: (jobId: string) => number;
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
    notices:  source.notices(),
    overseer: { ...source.overseer(), paused: board.dispatcherState() === 'stopped' },
    usage:    usageOf(context),
  });
  return { state, project: progress.project, readyTicketIds: board.readyTicketEntries().map((ready) => ready.id) };
}
