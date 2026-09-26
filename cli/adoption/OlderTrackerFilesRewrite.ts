import { rewriteOlderTrackerFiles, type TrackerRewrite } from '../../src/services/tracker/TrackerPipeline';
import type { Workspace }                                from '../../src/services/tracker/Workspace';
import type { CommandContext }                           from '../CommandContext';
import { OutputUtil }                                    from '../utils/OutputUtil';

/** For `update` and `init` on an existing tracker: a current, absent or unreadable tracker is `null`, and a rewrite reports its render. */
export async function rewriteOlderTrackerFilesAndReport(context: CommandContext, workspace: Workspace): Promise<TrackerRewrite | null> {
  const rewriting = await rewriteOlderTrackerFiles(workspace, context.now, context.renderState);
  if (rewriting.verdict !== 'rewritten') return null;
  OutputUtil.reportRenderProblems(context, rewriting.renderOutcome);
  return rewriting.rewrite;
}
