/** Renders under the lock without writing the progress file, so a concurrent write cannot leave the older picture on disk. */
import { withLock }            from '../../lib/platform/Lock';
import { OperationRefusal }    from '../../lib/platform/OperationRefusal';
import { requireWorkspace }    from '../../lib/platform/Workspace';
import { renderDashboard }     from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';

const USAGE = 'agent-progress render';

const KNOWN_OPTION_NAMES: readonly string[] = [];

export const renderCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  const outcome   = await withLock(workspace, () => renderDashboard(context, workspace), context.now);

  if (outcome.verdict === 'unreadable') {
    throw new OperationRefusal('unrepaired', `The dashboard could not be regenerated: ${outcome.reason}`);
  }
  context.standardOutput(workspace.htmlFilePath);
};
