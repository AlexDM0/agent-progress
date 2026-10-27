/**
 * Every name the product goes by on a machine: its program, its folders, its skills, its storage and environment prefixes, its login item
 * and its first runner port. A build linked beside the released one takes the side-by-side names, so neither reads or removes the other's
 * files. It imports nothing, so the dispatcher's project compiles it.
 */
export interface ProductNames {
  PROGRAM:             string;
  DATA_FOLDER:         string;
  WORKTREES_FOLDER:    string;
  MONITOR_FOLDER:      string;
  PRODUCT_OWNER_SKILL: string;
  ORCHESTRATE_SKILL:   string;
  STORAGE_PREFIX:      string;
  ENVIRONMENT_PREFIX:  string;
  LAUNCH_AGENT_LABEL:  string;
  RUNNER_PORT_FIRST:   number;
}

/** The names the released program has always gone by. */
export const ORIGINAL_PRODUCT_NAMES: Readonly<ProductNames> = {
  PROGRAM:             'agent-progress',
  DATA_FOLDER:         '.agent-progress',
  WORKTREES_FOLDER:    '.agent-progress-worktrees',
  MONITOR_FOLDER:      '.agent-progress-monitor',
  PRODUCT_OWNER_SKILL: 'agent-po',
  ORCHESTRATE_SKILL:   'agent-progress-orchestrate',
  STORAGE_PREFIX:      'agent-progress',
  ENVIRONMENT_PREFIX:  'AGENT_PROGRESS_',
  LAUNCH_AGENT_LABEL:  'com.agent-progress.runner',
  RUNNER_PORT_FIRST:   4730,
};

/** The names of a build `bun link`ed beside the released program while the code-owned lifecycle is under way. */
export const SIDE_BY_SIDE_PRODUCT_NAMES: Readonly<ProductNames> = {
  PROGRAM:             'agent-progress-v2',
  DATA_FOLDER:         '.agent-progress-v2',
  WORKTREES_FOLDER:    '.agent-progress-v2-worktrees',
  MONITOR_FOLDER:      '.agent-progress-v2-monitor',
  PRODUCT_OWNER_SKILL: 'agent-po-v2',
  ORCHESTRATE_SKILL:   'agent-progress-orchestrate-v2',
  STORAGE_PREFIX:      'agent-progress-v2',
  ENVIRONMENT_PREFIX:  'AGENT_PROGRESS_V2_',
  LAUNCH_AGENT_LABEL:  'com.agent-progress-v2.runner',
  RUNNER_PORT_FIRST:   4930,
};

export const PRODUCT_NAMES: Readonly<ProductNames> = SIDE_BY_SIDE_PRODUCT_NAMES;
