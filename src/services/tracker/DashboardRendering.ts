/**
 * Regenerates `progress.html` and its `progress.stamp.js` from what is on disk; every mutating command ends here inside its lock, and
 * `render` and `open` take the lock for it.
 */
import { createPageStampWriter }    from '../../adapters/page/PageStampWriter.ts';
import { writeFileAtomically }      from '../../lib/atomic-file/AtomicFile.ts';
import type { UnreadableTracker }   from '../../shared/@types/UnreadableTracker.ts';
import { renderDashboardDocument }  from '../render/DashboardDocument.ts';
import type { RenderState }         from '../render/RenderState.ts';
import type { MalformedTicketFile } from './TicketStore.ts';
import { withLock }                 from './TrackerLock.ts';
import { readTracker }              from './TrackerReader.ts';
import type { Workspace }           from './Workspace.ts';

export type DashboardRenderOutcome =
  | { verdict: 'rendered'; malformedTickets: MalformedTicketFile[] }
  | { verdict: 'rendered-without-page-script'; reason: string; malformedTickets: MalformedTicketFile[] }
  | { verdict: 'unreadable'; reading: UnreadableTracker };

/** `generatedAt` is the caller's clock. An unreadable tracker writes no page. */
export async function renderDashboard(workspace: Workspace, generatedAt: Date, renderState: RenderState): Promise<DashboardRenderOutcome> {
  const reading = readTracker(workspace);
  if (reading.verdict !== 'readable') return { verdict: 'unreadable', reading };

  const { progress, storedLog, listing } = reading.contents;
  const rendering = await renderDashboardDocument({
    progress,
    tickets:    listing.tickets,
    logRecords: storedLog.records,
    generatedAt,
  }, renderState);
  writeFileAtomically(workspace.htmlFilePath, rendering.document);
  // After the page, so a stamp never announces a render whose page is not on disk yet.
  createPageStampWriter(workspace.stampFilePath).write(generatedAt);

  if (rendering.pageScriptFailure !== null) {
    return { verdict: 'rendered-without-page-script', reason: rendering.pageScriptFailure, malformedTickets: listing.malformed };
  }
  return { verdict: 'rendered', malformedTickets: listing.malformed };
}

/** For `render` and `open`: under the lock, so a concurrent write cannot leave the older picture on disk. */
export function renderDashboardUnderLock(workspace: Workspace, now: () => Date, renderState: RenderState): Promise<DashboardRenderOutcome> {
  return withLock(workspace, () => renderDashboard(workspace, now(), renderState), now);
}
