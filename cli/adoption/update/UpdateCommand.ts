/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up a newer brief or CLAUDE.md block. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and never touches the tracker's own files.
 */
import { requireWorkspace }                            from '../../../src/services/tracker/Workspace.ts';
import type { CommandHandler }                         from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace } from '../../InstallVersionCheck.ts';
import { installedFileTextsFor }                       from '../InstalledFileGeneration.ts';
import {
  recordInstallVersion,
  refreshReportLinesOf,
  refreshTrackedRepository,
  refuseAnAgentDefinitionOptOutKeepingTheWorkflow,
  refuseKeepingADispatcherWithoutItsAgentDefinition
}                                                                             from '../TrackerRefresh.ts';

const USAGE = 'agent-progress update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

const KNOWN_OPTION_NAMES = ['no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition'];

export const updateCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const writesTheDispatcherWorkflow = !commandArguments.flag('no-workflow');
  const writesTheAgentDefinition    = !commandArguments.flag('no-agent-definition');
  refuseAnAgentDefinitionOptOutKeepingTheWorkflow('update', { writesTheAgentDefinition, writesTheDispatcherWorkflow });

  const workspace          = requireWorkspace(context.currentDirectory);
  requireInstallManifestThisVersionCanReplace(workspace.rootDirectory);
  refuseKeepingADispatcherWithoutItsAgentDefinition('update', workspace.rootDirectory, { writesTheAgentDefinition, writesTheDispatcherWorkflow });
  const installedFileTexts = await installedFileTextsFor({ generatesTheDispatcherScript: writesTheDispatcherWorkflow });
  const report             = refreshTrackedRepository({
    workspace,
    installedFileTexts,
    commandName:               'update',
    writesClaudeInstructions:  !commandArguments.flag('no-claude-md'),
    writesTheSubagentStopHook: !commandArguments.flag('no-hooks'),
    writesTheAgentDefinition,
    writesTheBriefFirst:       false,
    standardError:             context.standardError,
  });

  context.standardOutput(`Refreshed what agent-progress manages in ${workspace.rootDirectory}; the tracker itself was not touched.`);
  for (const line of refreshReportLinesOf(report, workspace.htmlFilePath)) context.standardOutput(line);
  recordInstallVersion(workspace.rootDirectory);
};
