import { TrackerReadingWordingUtil } from '../../src/adapters/utils/TrackerReadingWordingUtil';
import { renderDashboardUnderLock }  from '../../src/services/tracker/DashboardRendering';
import type { Workspace }            from '../../src/services/tracker/Workspace';
import { OperationRefusal }          from '../../src/shared/OperationRefusal';
import type { CommandContext }       from '../CommandContext';
import { OutputUtil }                from '../utils/OutputUtil';

/** For `render` and `open`, whose whole job is the page: an unreadable tracker is their failure, reported once, by the refusal alone. */
export async function renderDashboardOrRefuse(context: CommandContext, workspace: Workspace): Promise<void> {
  const outcome = await renderDashboardUnderLock(workspace, context.now, context.renderState);
  if (outcome.verdict === 'unreadable') {
    throw new OperationRefusal('unrepaired', `The dashboard could not be regenerated: ${TrackerReadingWordingUtil.renderReasonOf(outcome.reading)}`);
  }
  OutputUtil.reportRenderProblems(context, outcome);
}
