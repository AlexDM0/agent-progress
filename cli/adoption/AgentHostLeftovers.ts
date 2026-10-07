/**
 * The refusal `init` and `update` raise before their first write while another agent host's installed files are present: Copilot CLI runs a
 * `.github/agents/` worker over its `.claude/agents/` namesake without a word, so these files are the only sign two hosts would both run.
 */
import { existsSync } from 'node:fs';

import { claudeLocalSettingsFilePathFor, claudeSettingsFilePathFor, commandHookIsPresent } from '../../src/lib/claude-code/ClaudeSettings.ts';
import { OperationRefusal }                                                                from '../../src/shared/OperationRefusal.ts';
import { AGENT_HOSTS, type AgentHost }                                                     from '../../src/shared/constants/AgentHosts.ts';
import { installedFilePathsIn }                                                            from '../InstalledFiles.ts';
import { AGENT_HOST_INSTALLS }                                                             from './constants/AgentHostInstalls.ts';

/** Each marker of the host found in the repository, worded as the refusal names it. */
function leftoversOf(agentHost: AgentHost, rootDirectory: string): string[] {
  const { markers } = AGENT_HOST_INSTALLS[agentHost];
  const installedFilePaths = installedFilePathsIn(rootDirectory);
  const leftoverFiles = markers.files.map((fileName) => installedFilePaths[fileName]).filter((filePath) => existsSync(filePath));
  const settingsFilePaths = [claudeSettingsFilePathFor(rootDirectory), claudeLocalSettingsFilePathFor(rootDirectory)];
  const leftoverHooks = markers.hooks.flatMap((hook) => settingsFilePaths
    .filter((settingsFilePath) => commandHookIsPresent(settingsFilePath, hook))
    .map((settingsFilePath) => `the ${hook.event} hook \`${hook.command}\` in ${settingsFilePath}`));
  return [...leftoverFiles, ...leftoverHooks];
}

export function refuseAnotherAgentHostsLeftovers(commandName: string, { rootDirectory, agentHost }: { rootDirectory: string; agentHost: AgentHost }): void {
  for (const otherHost of AGENT_HOSTS.filter((host) => host !== agentHost)) {
    const leftovers = leftoversOf(otherHost, rootDirectory);
    if (leftovers.length === 0) continue;
    throw new OperationRefusal(
      'refused',
      `agent-progress ${commandName} would install for ${agentHost}, but this repository still holds what agent-progress installed for ${otherHost}: `
      + `${leftovers.join('; ')}. Both hosts would then run their own worker, so nothing was written and nothing was removed. `
      + `Remove those yourself to switch to ${agentHost}, or run \`agent-progress init --host ${otherHost}\` to stay on ${otherHost}.`,
    );
  }
}
