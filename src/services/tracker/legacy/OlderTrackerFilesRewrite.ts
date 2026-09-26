/**
 * It rewrites a tracker still in an older format (a progress file carrying its log, tickets in retired words) in the current one for `update` and `init`.
 * It can be deleted once every tracker has been rewritten by `agent-progress update`.
 */
import type { RenderState }                             from '../../render/RenderState.ts';
import { renderDashboard, type DashboardRenderOutcome } from '../DashboardRendering.ts';
import { withLock }                                     from '../TrackerLock.ts';
import { writeTrackerUnchanged }                        from '../TrackerPipeline.ts';
import { readTracker, type TrackerContents }            from '../TrackerReader.ts';
import type { Workspace }                               from '../Workspace.ts';

export interface TrackerRewrite {
  progressFileWasRewritten: boolean;
  rewrittenTicketCount:     number;
}

export type TrackerRewriting =
  | { verdict: 'current' }
  | { verdict: 'unreadable' }
  | { verdict: 'rewritten'; rewrite: TrackerRewrite; renderOutcome: DashboardRenderOutcome };

function trackerIsInAnOlderFormat(contents: TrackerContents): boolean {
  return contents.storedLog.logFileMustBeRewritten || contents.listing.ticketsInAnOlderFormat.length > 0;
}

/**
 * For `update` and `init` on an existing tracker: a readable tracker still in an older format is written in the current one through the
 * pipeline's two halves, with nothing changed and nothing logged. Checked without the lock first, then again under it; a second run answers `current`.
 */
export async function rewriteOlderTrackerFiles(workspace: Workspace, now: () => Date, renderState: RenderState): Promise<TrackerRewriting> {
  const readingWithoutTheLock = readTracker(workspace);
  if (readingWithoutTheLock.verdict !== 'readable') return { verdict: 'unreadable' };
  if (!trackerIsInAnOlderFormat(readingWithoutTheLock.contents)) return { verdict: 'current' };

  return withLock(workspace, async (): Promise<TrackerRewriting> => {
    const reading = readTracker(workspace);
    if (reading.verdict !== 'readable') return { verdict: 'unreadable' };
    // Another command may have written the tracker since the read above, and a current tracker is left alone.
    if (!trackerIsInAnOlderFormat(reading.contents)) return { verdict: 'current' };

    const { contents } = reading;
    const extraTickets = contents.listing.ticketsInAnOlderFormat;
    writeTrackerUnchanged(workspace, contents, extraTickets);
    const renderOutcome = await renderDashboard(workspace, now(), renderState);
    return {
      verdict: 'rewritten',
      rewrite: { progressFileWasRewritten: contents.storedLog.logFileMustBeRewritten, rewrittenTicketCount: extraTickets.length },
      renderOutcome,
    };
  }, now);
}
