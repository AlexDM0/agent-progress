/** Where each file the tool installs into a tracked repository lives, and the markers of the block it owns in `CLAUDE.md`. */
import { join } from 'node:path';

import type { ManagedBlockMarkers } from '../src/lib/claude-code/ClaudeInstructions.ts';
import { TRACKER_FILES }            from '../src/services/tracker/constants/TrackerFiles.ts';
import { DISPATCH_PROTOCOL }        from '../src/shared/constants/DispatchProtocol.ts';

/** Named as the dispatcher's `meta.name`; it is launched by its path only. */
const DISPATCHER_SCRIPT_FILE_NAME = 'agent-progress-dispatch.js';

const INSTALL_MANIFEST_FILE_NAME = 'version.json';

/** Neither marker may contain the other: `src/lib/claude-code/ClaudeInstructions.ts` finds the end by searching forward from the start. */
export const CLAUDE_MANAGED_BLOCK_MARKERS: ManagedBlockMarkers = {
  start: '<!-- agent-progress:managed:start -->',
  end:   '<!-- agent-progress:managed:end -->',
};

export interface InstalledFilePaths {
  agentBrief:         string;
  claudeInstructions: string;
  dispatcherScript:   string;
  /** Claude Code reads a project's subagent definitions from `.claude/agents/`; the file name matches the definition's `name`. */
  agentDefinition:    string;
  installManifest:    string;
}

export function installedFilePathsIn(rootDirectory: string): InstalledFilePaths {
  return {
    agentBrief:         join(rootDirectory, DISPATCH_PROTOCOL.AGENT_BRIEF_PATH_IN_REPOSITORY),
    claudeInstructions: join(rootDirectory, 'CLAUDE.md'),
    dispatcherScript:   join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, DISPATCHER_SCRIPT_FILE_NAME),
    agentDefinition:    join(rootDirectory, '.claude', 'agents', 'agent-progress-worker.md'),
    installManifest:    join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, INSTALL_MANIFEST_FILE_NAME),
  };
}
