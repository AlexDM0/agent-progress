import { writeFileAtomically }                from '../../lib/atomic-file/AtomicFile.ts';
import { DEFAULT_AGENT_HOST, type AgentHost } from '../../shared/constants/AgentHosts.ts';
import { JsonTextUtil }                       from '../../shared/utils/JsonTextUtil.ts';

export interface InstallManifest {
  installVersion: number;
  agentHost:      AgentHost;
}

export function createInstallManifestWriter(manifestFilePath: string): { write(manifest: InstallManifest): void } {
  /** Indented and newline-terminated like progress.json, because people read and repair it by hand; the default host is left unwritten. */
  function write({ installVersion, agentHost }: InstallManifest): void {
    writeFileAtomically(manifestFilePath, JsonTextUtil.storedFileTextOf(agentHost === DEFAULT_AGENT_HOST ? { installVersion } : { installVersion, agentHost }));
  }
  return { write };
}
