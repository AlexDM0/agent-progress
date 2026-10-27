import { existsSync } from 'node:fs';

import { requireWorkspace }        from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }           from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }     from '../../CommandHandler.ts';
import { openInTheDefaultBrowser } from '../../OpenInTheDefaultBrowser.ts';
import { renderDashboardOrRefuse } from '../RenderDashboardOrRefuse.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} open`;

const KNOWN_OPTION_NAMES: readonly string[] = [];

export const openCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  if (!existsSync(workspace.htmlFilePath)) {
    await renderDashboardOrRefuse(context, workspace);
  }

  openInTheDefaultBrowser(context, workspace.htmlFilePath);
  context.standardOutput(workspace.htmlFilePath);
};
