/** Where each file the tool installs into a tracked repository lives. */
import { join } from 'node:path';

import { TRACKER_FILES }     from '../src/services/tracker/constants/TrackerFiles.ts';
import { DISPATCH_PROTOCOL } from '../src/shared/constants/DispatchProtocol.ts';

/** Named as the dispatcher's `meta.name`; it is launched by its path only. */
const DISPATCHER_SCRIPT_FILE_NAME = 'agent-progress-dispatch.js';

const INSTALL_MANIFEST_FILE_NAME = 'version.json';

export interface InstalledFilePaths {
  agentBrief:         string;
  builderBrief:       string;
  reviewBrief:        string;
  claudeInstructions: string;
  dispatcherScript:   string;
  /** Claude Code reads a project's subagent definitions from `.claude/agents/`; the file name matches the definition's `name`. */
  agentDefinition:    string;
  installManifest:    string;
}

export function installedFilePathsIn(rootDirectory: string): InstalledFilePaths {
  return {
    agentBrief:         join(rootDirectory, DISPATCH_PROTOCOL.AGENT_BRIEF_PATH_IN_REPOSITORY),
    builderBrief:       join(rootDirectory, DISPATCH_PROTOCOL.BUILDER_BRIEF_PATH_IN_REPOSITORY),
    reviewBrief:        join(rootDirectory, DISPATCH_PROTOCOL.REVIEW_BRIEF_PATH_IN_REPOSITORY),
    claudeInstructions: join(rootDirectory, 'CLAUDE.md'),
    dispatcherScript:   join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, DISPATCHER_SCRIPT_FILE_NAME),
    agentDefinition:    join(rootDirectory, '.claude', 'agents', `${DISPATCH_PROTOCOL.WORKER_AGENT_TYPE}.md`),
    installManifest:    join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, INSTALL_MANIFEST_FILE_NAME),
  };
}
