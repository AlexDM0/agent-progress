import { existsSync } from 'node:fs';

import { withLock }                from '../../lib/platform/Lock';
import { requireWorkspace }        from '../../lib/platform/Workspace';
import { renderDashboardOrRefuse } from '../CommandSupport';
import type { CommandHandler }     from '../CommandTable';

const USAGE = 'agent-progress open';

const KNOWN_OPTION_NAMES: readonly string[] = [];

const MACOS_OPENER = 'open';
const OTHER_OPENER = 'xdg-open';

const MACOS_PLATFORM = 'darwin';

export function openerForPlatform(platform: string): string {
  return platform === MACOS_PLATFORM ? MACOS_OPENER : OTHER_OPENER;
}

export const openCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  if (!existsSync(workspace.htmlFilePath)) {
    await withLock(workspace, () => renderDashboardOrRefuse(context, workspace), context.now);
  }

  const opener = openerForPlatform(context.platform);
  try {
    // Detached with its streams dropped: a browser launched cold would otherwise inherit the pipes and keep this process alive.
    const spawned = Bun.spawn([opener, workspace.htmlFilePath], {
      stdin:  'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    spawned.unref();
  } catch (problem) {
    // Reported, not thrown: the path is still printed below, so a machine with no desktop is not a failed command.
    context.standardError(`\`${opener}\` could not be run (${problem instanceof Error ? problem.message : String(problem)}); open the path below yourself.`);
  }

  context.standardOutput(workspace.htmlFilePath);
};
