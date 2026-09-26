/**
 * How `update` and `init` run the rewrite of older tracker files and report it, heading lines included.
 * It can be deleted once every tracker has been rewritten by `agent-progress update`.
 */
import type { Workspace }                                from '../../src/services/tracker/Workspace';
import { rewriteOlderTrackerFiles, type TrackerRewrite } from '../../src/services/tracker/legacy/OlderTrackerFilesRewrite';
import type { CommandContext }                           from '../CommandContext';
import { OutputUtil }                                    from '../utils/OutputUtil';
import { TrackerRewriteTextUtil }                        from './utils/TrackerRewriteTextUtil';

/** A current, absent or unreadable tracker is `null`, and a rewrite reports its render. */
async function rewriteOlderTrackerFilesAndReport(context: CommandContext, workspace: Workspace): Promise<TrackerRewrite | null> {
  const rewriting = await rewriteOlderTrackerFiles(workspace, context.now, context.renderState);
  if (rewriting.verdict !== 'rewritten') return null;
  OutputUtil.reportRenderProblems(context, rewriting.renderOutcome);
  return rewriting.rewrite;
}

async function rewriteThenPrintUpdateHeading(
  context: CommandContext,
  workspace: Workspace,
  printRefreshReport: (headingLine: string) => void,
): Promise<void> {
  let rewrite: TrackerRewrite | null;
  try {
    rewrite = await rewriteOlderTrackerFilesAndReport(context, workspace);
  } catch (error) {
    // The repository files are already refreshed, and a session must still learn its brief is stale; the refusal then exits 2.
    printRefreshReport(`Refreshed what agent-progress manages in ${workspace.rootDirectory}; `
      + 'rewriting its older tracker files did not finish, so some may already be in the current format.');
    throw error;
  }
  printRefreshReport(rewrite === null
    ? `Refreshed what agent-progress manages in ${workspace.rootDirectory}; the tracker itself was not touched.`
    : `Refreshed what agent-progress manages in ${workspace.rootDirectory}, and rewrote its older tracker files in the current format: `
      + `${TrackerRewriteTextUtil.rewrittenFilesTextOf(rewrite)}.`);
}

async function rewriteThenPrintInitTrackerLine(
  context: CommandContext,
  workspace: Workspace,
  printRefreshReport: (trackerLine: string | null) => void,
): Promise<void> {
  let rewrite: TrackerRewrite | null;
  try {
    rewrite = await rewriteOlderTrackerFilesAndReport(context, workspace);
  } catch (error) {
    // The repository files are already refreshed, and a session must still learn its brief is stale; the refusal then exits 2.
    printRefreshReport('rewriting older files did not finish; some may already be in the current format');
    throw error;
  }
  printRefreshReport(rewrite === null ? null : `rewrote ${TrackerRewriteTextUtil.rewrittenFilesTextOf(rewrite)} in the current format`);
}

export const OlderTrackerFilesRewriteReport = { rewriteThenPrintUpdateHeading, rewriteThenPrintInitTrackerLine } as const;
