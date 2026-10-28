import { existsSync } from 'node:fs';

import { runnerFilesIn }           from '../../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }             from '../../../src/services/runner/RunnerLease.ts';
import { requireWorkspace }        from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }           from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }     from '../../CommandHandler.ts';
import { openInTheDefaultBrowser } from '../../OpenInTheDefaultBrowser.ts';
import { renderDashboardOrRefuse } from '../RenderDashboardOrRefuse.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} open`;

const KNOWN_OPTION_NAMES: readonly string[] = [];

/** The live runner's URL while a lease names a live process; the static page until the runner is the only page. */
export const openCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  const newest    = RunnerLease.newestLeaseOf(runnerFilesIn(workspace.trackerDirectory).runnerDirectory);
  if (newest.verdict === 'live') {
    openInTheDefaultBrowser(context, newest.record.url);
    context.standardOutput(newest.record.url);
    return;
  }
  if (!existsSync(workspace.htmlFilePath)) {
    await renderDashboardOrRefuse(context, workspace);
  }

  openInTheDefaultBrowser(context, workspace.htmlFilePath);
  context.standardOutput(workspace.htmlFilePath);
};
