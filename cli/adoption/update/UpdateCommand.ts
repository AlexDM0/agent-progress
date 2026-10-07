/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up a newer brief or CLAUDE.md block. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and never touches the tracker's own files.
 */
import { InstallManifestIngestion }                          from '../../../src/adapters/install/InstallManifestIngestion.ts';
import { requireWorkspace }                                  from '../../../src/services/tracker/Workspace.ts';
import { DEFAULT_AGENT_HOST, type AgentHost }                from '../../../src/shared/constants/AgentHosts.ts';
import type { CommandHandler }                               from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace }       from '../../InstallVersionCheck.ts';
import { installedFilePathsIn }                              from '../../InstalledFiles.ts';
import { refuseAnotherAgentHostsLeftovers }                  from '../AgentHostLeftovers.ts';
import { installedFileTextsFor, installedSkillFileTextsFor } from '../InstalledFileGeneration.ts';
import {
  optOutFlagsGiven,
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
  const optOutFlags                 = optOutFlagsGiven((flagName) => commandArguments.flag(flagName));
  const writesTheDispatcherWorkflow = !optOutFlags.has('no-workflow');
  const writesTheAgentDefinition    = !optOutFlags.has('no-agent-definition');
  refuseAnAgentDefinitionOptOutKeepingTheWorkflow('update', { writesTheAgentDefinition, writesTheDispatcherWorkflow });

  const workspace          = requireWorkspace(context.currentDirectory);
  requireInstallManifestThisVersionCanReplace(workspace.rootDirectory);
  const agentHost          = storedAgentHostIn(workspace.rootDirectory);
  refuseKeepingADispatcherWithoutItsAgentDefinition('update', { rootDirectory: workspace.rootDirectory, agentHost }, { writesTheAgentDefinition, writesTheDispatcherWorkflow });
  refuseAnotherAgentHostsLeftovers('update', { rootDirectory: workspace.rootDirectory, agentHost });
  const installedFileTexts = await installedFileTextsFor({ agentHost, generatesTheDispatcherScript: writesTheDispatcherWorkflow });
  const installedSkillFileTexts = installedSkillFileTextsFor(agentHost);
  const report             = refreshTrackedRepository({
    workspace,
    agentHost,
    installedFileTexts,
    installedSkillFileTexts,
    commandName:         'update',
    optOutFlags,
    writesTheBriefFirst: false,
    standardError:       context.standardError,
  });

  context.standardOutput(`Refreshed what agent-progress manages in ${workspace.rootDirectory}; the tracker itself was not touched.`);
  for (const line of refreshReportLinesOf(report, workspace.htmlFilePath)) context.standardOutput(line);
  recordInstallVersion(workspace.rootDirectory, agentHost);
};

/** A manifest that is absent or unreadable is the default host's: its files then refuse a repository installed for another one. */
function storedAgentHostIn(rootDirectory: string): AgentHost {
  const reading = new InstallManifestIngestion(installedFilePathsIn(rootDirectory).installManifest).read();
  return reading.verdict === 'readable' ? reading.agentHost : DEFAULT_AGENT_HOST;
}
