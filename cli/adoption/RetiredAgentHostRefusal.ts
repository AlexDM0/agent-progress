/**
 * The refusal `init` and `update` raise before their first write on a repository an install before version 11 adopted for the Copilot CLI
 * host, which agent-progress no longer installs for: its worker and extension would keep running beside the Claude Code ones.
 */
import { InstallManifestIngestion } from '../../src/adapters/install/InstallManifestIngestion.ts';
import { OperationRefusal }         from '../../src/shared/OperationRefusal.ts';
import { installedFilePathsIn }     from '../InstalledFiles.ts';

const RETIRED_AGENT_HOST = 'copilot-cli';

const RETIRED_HOST_FILES_IN_REPOSITORY = ['.github/agents/agent-progress-worker.agent.md', '.github/extensions/agent-progress/'];

export function refuseARetiredAgentHostsInstall(commandName: string, rootDirectory: string): void {
  const manifestFilePath = installedFilePathsIn(rootDirectory).installManifest;
  const reading = new InstallManifestIngestion(manifestFilePath).read();
  if (reading.verdict !== 'readable' || reading.agentHost !== RETIRED_AGENT_HOST) return;
  throw new OperationRefusal(
    'refused',
    `agent-progress ${commandName} installs for Claude Code only, but ${manifestFilePath} names the agent host ${RETIRED_AGENT_HOST}, `
    + 'which agent-progress no longer installs for. Nothing was written. Remove what it installed for Copilot CLI yourself, '
    + `${RETIRED_HOST_FILES_IN_REPOSITORY.join(' and ')} in ${rootDirectory}, and the agentHost key from ${manifestFilePath}, `
    + `then run \`agent-progress ${commandName}\` again.`,
  );
}
