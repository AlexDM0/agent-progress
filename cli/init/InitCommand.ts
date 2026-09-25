/** The ignore entry goes in before the tracker directory exists, so the tracker is never briefly visible to `git status`. */
import { randomUUID }                        from 'node:crypto';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve }                 from 'node:path';

import { agentProgressRootOverride }                   from '../../lib/platform/Environment';
import { ensureIgnored }                               from '../../lib/platform/GitIgnore';
import { withLock }                                    from '../../lib/platform/Lock';
import { OperationRefusal }                            from '../../lib/platform/OperationRefusal';
import { discoverRepositoryRoot }                      from '../../lib/platform/RepositoryRoot';
import { findWorkspace, workspacePathsFor }            from '../../lib/platform/Workspace';
import { createEmptyProgressFile, createProgressFile } from '../../lib/progress/ProgressStore';
import { TimeUtil }                                    from '../../lib/utils/TimeUtil';
import { renderDashboard }                             from '../CommandSupport';
import type { CommandHandler }                         from '../CommandTable';
import { refreshTrackedRepository }                    from '../TrackerRefresh';

const USAGE = 'agent-progress init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

// `--hooks` is kept, and does nothing: the hook it used to ask for is now written by default, and a habit that still types it should not be refused.
const KNOWN_OPTION_NAMES = ['project', 'root', 'no-claude-md', 'hooks', 'no-hooks', 'no-workflow', 'no-agent-definition'];

const IGNORE_OUTCOME_WORDS: Record<string, string> = {
  'already-ignored':      'already ignored, so nothing was added',
  'appended':             'entry added',
  'no-gitignore-written': 'not written — this directory is not a git repository',
};

function resolvedRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A bare repository is refused: it has no working tree, and guessing a directory near it would write into somebody else's. */
function discoveredRootForInit(currentDirectory: string): string {
  const discovery = discoverRepositoryRoot(currentDirectory);
  if (discovery.source === 'bare-repository') {
    throw new OperationRefusal(
      'refused',
      `${discovery.rootDirectory} is inside a bare git repository, which has no working tree to track. `
      + 'Run `agent-progress init` in a checkout of it, or pass --root <path> to track a directory explicitly.',
    );
  }
  return discovery.rootDirectory;
}

/** `--root` must name an existing directory: `init` does not create one, or a mistyped path would make a tracker nobody looks at. */
function requiredExistingDirectory(candidatePath: string, asWritten: string): string {
  let isADirectory = false;
  try {
    isADirectory = statSync(candidatePath).isDirectory();
  } catch {
    // Fail closed: anything a `stat` cannot answer is not a directory to write a tracker into.
  }
  if (!isADirectory) {
    throw new OperationRefusal(
      'refused',
      `--root "${asWritten}" is not an existing directory (${candidatePath}). `
      + 'Create it first, or leave --root off to track the repository `agent-progress` discovers from here.',
    );
  }
  return candidatePath;
}

/** `AGENT_PROGRESS_ROOT` does not choose where `init` writes, so one naming another directory is refused rather than half-obeyed. */
function refuseAnOverrideNamingAnotherDirectory(currentDirectory: string, rootDirectory: string): void {
  const overrideRoot = agentProgressRootOverride();
  if (overrideRoot === undefined) return;
  const overriddenDirectory = resolvedRealPath(resolve(currentDirectory, overrideRoot));
  if (overriddenDirectory === resolvedRealPath(rootDirectory)) return;
  throw new OperationRefusal(
    'refused',
    `AGENT_PROGRESS_ROOT names ${overriddenDirectory}, but \`init\` would create the tracker in ${rootDirectory}; nothing was written. `
    + 'Unset AGENT_PROGRESS_ROOT, or set it to the directory you are initialising, or pass that directory as --root.',
  );
}

export const initCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const rootOption    = commandArguments.option('root');
  const rootDirectory = rootOption === undefined
    ? discoveredRootForInit(context.currentDirectory)
    : requiredExistingDirectory(resolvedRealPath(resolve(context.currentDirectory, rootOption)), rootOption);
  const workspace     = workspacePathsFor(rootDirectory);
  const writesClaudeInstructions = !commandArguments.flag('no-claude-md');
  const writesTheSubagentStopHook = !commandArguments.flag('no-hooks');
  const writesTheDispatcherWorkflow = !commandArguments.flag('no-workflow');
  const writesTheAgentDefinition = !commandArguments.flag('no-agent-definition');

  refuseAnOverrideNamingAnotherDirectory(context.currentDirectory, rootDirectory);

  // The brief, the block and the hook are written by the same refresh a second `init` and `update` run, so a fresh tracker and an adopted one never drift.
  const refreshTheRepository = () => refreshTrackedRepository({
    workspace,
    commandName:   'init',
    writesClaudeInstructions,
    writesTheSubagentStopHook,
    writesTheDispatcherWorkflow,
    writesTheAgentDefinition,
    standardError: context.standardError,
  });
  const reportTheRefreshOfAnExistingTracker = () => {
    const refresh = refreshTheRepository();
    context.standardOutput(`agent-progress is already initialised in ${rootDirectory}.`);
    context.standardOutput(`  CLAUDE.md:   ${refresh.claudeInstructionsLine}`);
    context.standardOutput(`  brief:       ${refresh.briefLine}`);
    context.standardOutput(`  hooks:       ${refresh.hookLine}`);
    context.standardOutput(`  workflow:    ${refresh.workflowLine}`);
    context.standardOutput(`  agent:       ${refresh.agentDefinitionLine}`);
    context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
    context.standardOutput('  `agent-progress update` is the command for this refresh; `init` only creates a tracker.');
  };

  const existingWorkspace = findWorkspace(rootDirectory);
  if (existingWorkspace !== null) {
    if (existingWorkspace.rootDirectory !== workspace.rootDirectory) {
      throw new OperationRefusal(
        'refused',
        `A tracker already governs this directory: ${existingWorkspace.trackerDirectory}. `
        + `Run \`agent-progress update\` in ${existingWorkspace.rootDirectory} instead to refresh what the tracker writes into the repository.`,
      );
    }
    reportTheRefreshOfAnExistingTracker();
    return;
  }

  const ignoreOutcome = ensureIgnored(rootDirectory);
  mkdirSync(workspace.ticketsDirectory, { recursive: true });

  const progress = createEmptyProgressFile({
    project:   commandArguments.option('project') ?? basename(rootDirectory),
    startedAt: TimeUtil.formatLocalIso(context.now()),
    // The page's localStorage key: `file://` is one origin in Chrome, so two trackers would otherwise share a saved range.
    trackerId: randomUUID(),
  });

  const creation = await withLock(workspace, async () => {
    const verdict = createProgressFile(workspace, progress);
    if (verdict === 'created') await renderDashboard(context, workspace);
    return verdict;
  }, context.now);
  if (creation === 'already-exists') {
    reportTheRefreshOfAnExistingTracker();
    return;
  }

  const refresh = refreshTheRepository();

  context.standardOutput(`Initialised agent-progress for "${progress.project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  brief:       ${refresh.briefFilePath}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome] ?? ignoreOutcome}`);
  context.standardOutput(`  CLAUDE.md:   ${refresh.claudeInstructionsLine}`);
  context.standardOutput(`  hooks:       ${refresh.hookLine}`);
  context.standardOutput(`  workflow:    ${refresh.workflowLine}`);
  context.standardOutput(`  agent:       ${refresh.agentDefinitionLine}`);
};
