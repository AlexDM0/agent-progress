/** Renders without writing the progress file; the tracker service takes the lock, so a concurrent write cannot leave the older picture on disk. */
import { requireWorkspace }        from '../../src/services/tracker/Workspace';
import { renderDashboardOrRefuse } from '../CommandSupport';
import type { CommandHandler }     from '../CommandTable';

const USAGE = 'agent-progress render';

const KNOWN_OPTION_NAMES: readonly string[] = [];

export const renderCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  await renderDashboardOrRefuse(context, workspace);
  context.standardOutput(workspace.htmlFilePath);
};
