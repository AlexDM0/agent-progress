/**
 * What install version 16 wrote that 17 removes once: the three hook entries and the files below. Kept out of
 * `cli/adoption/constants/ClaudeCodeInstall.ts`, which `cli/InstalledSurface.spec.ts` scans, so no installed surface names them.
 */
import { join } from 'node:path';

import type { CommandHook }  from '../../../src/lib/claude-code/ClaudeSettings.ts';
import { DISPATCH_PROTOCOL } from '../../../src/shared/constants/DispatchProtocol.ts';
import { PRODUCT_NAMES }     from '../../../src/shared/constants/ProductNames.ts';

export const RETIRED_HOOKS: readonly Pick<CommandHook, 'event' | 'command'>[] = [
  { event: 'SubagentStop', command: `${PRODUCT_NAMES.PROGRAM} hook subagent-stop` },
  { event: 'PreToolUse', command: `${PRODUCT_NAMES.PROGRAM} hook pre-tool-use` },
  { event: 'PostToolUse', command: `${PRODUCT_NAMES.PROGRAM} hook post-tool-use` },
];

export interface RetiredInstalledFilePaths {
  /** The orchestrator's brief, which marked an install before version 17 and still does for the version check. */
  agentBrief:       string;
  builderBrief:     string;
  reviewBrief:      string;
  dispatcherScript: string;
  agentDefinition:  string;
}

export function retiredInstalledFilePathsIn(rootDirectory: string): RetiredInstalledFilePaths {
  return {
    agentBrief:       join(rootDirectory, PRODUCT_NAMES.DATA_FOLDER, 'agent-brief.md'),
    builderBrief:     join(rootDirectory, PRODUCT_NAMES.DATA_FOLDER, 'builder-brief.md'),
    reviewBrief:      join(rootDirectory, PRODUCT_NAMES.DATA_FOLDER, 'review-brief.md'),
    dispatcherScript: join(rootDirectory, PRODUCT_NAMES.DATA_FOLDER, 'agent-progress-dispatch.js'),
    agentDefinition:  join(rootDirectory, '.claude', 'agents', `${DISPATCH_PROTOCOL.WORKER_AGENT_TYPE}.md`),
  };
}
