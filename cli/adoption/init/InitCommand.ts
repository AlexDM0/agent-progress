/** The ignore entry goes in before the tracker directory exists, so the tracker is never briefly visible to `git status`. */
import { randomUUID }             from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, resolve }      from 'node:path';

import { ensureIgnored }                                  from '../../../src/lib/git/GitIgnore';
import { discoverRepositoryRoot }                         from '../../../src/lib/git/RepositoryRoot';
import { TimeUtil }                                       from '../../../src/lib/utils/TimeUtil';
import { createTracker }                                  from '../../../src/services/tracker/TrackerCreation';
import { findWorkspace, workspacePathsFor }               from '../../../src/services/tracker/Workspace';
import { TRACKER_FILES }                                  from '../../../src/services/tracker/constants/TrackerFiles';
import { agentProgressRootOverride }                      from '../../../src/shared/Environment';
import { OperationRefusal }                               from '../../../src/shared/OperationRefusal';
import type { CommandHandler }                            from '../../CommandTable';
import { OlderTrackerFilesRewriteReport }                 from '../../legacy/OlderTrackerFilesRewriteReport';
import { IGNORED_RETIRED_OPTION_NAMES }                   from '../../legacy/constants/IgnoredRetiredOptions';
import { OutputUtil }                                     from '../../utils/OutputUtil';
import { installedFileTextsFor }                          from '../InstalledFileGeneration';
import type { InstalledFileTexts }                        from '../InstalledFileGeneration';
import { recordInstallVersion, refreshTrackedRepository } from '../TrackerRefresh';

const USAGE = 'agent-progress init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

const KNOWN_OPTION_NAMES = ['project', 'root', 'no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition', ...IGNORED_RETIRED_OPTION_NAMES];

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
  const refreshTheRepository = (installedFileTexts: InstalledFileTexts) => refreshTrackedRepository({
    workspace,
    installedFileTexts,
    commandName:   'init',
    writesClaudeInstructions,
    writesTheSubagentStopHook,
    writesTheAgentDefinition,
    standardError: context.standardError,
  });
  const reportTheRefreshOfAnExistingTracker = async (installedFileTexts: InstalledFileTexts) => {
    const refresh = refreshTheRepository(installedFileTexts);
    const printRefreshReport = (trackerLine: string | null) => {
      context.standardOutput(`agent-progress is already initialised in ${rootDirectory}.`);
      if (trackerLine !== null) context.standardOutput(`  tracker:     ${trackerLine}`);
      context.standardOutput(`  CLAUDE.md:   ${refresh.claudeInstructionsLine}`);
      context.standardOutput(`  brief:       ${refresh.briefLine}`);
      context.standardOutput(`  hooks:       ${refresh.hookLine}`);
      context.standardOutput(`  workflow:    ${refresh.workflowLine}`);
      context.standardOutput(`  agent:       ${refresh.agentDefinitionLine}`);
      context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
      context.standardOutput('  `agent-progress update` is the command for this refresh; `init` only creates a tracker.');
    };

    // Dropping cli/legacy/ makes this printRefreshReport(null).
    await OlderTrackerFilesRewriteReport.rewriteThenPrintInitTrackerLine(context, workspace, printRefreshReport);
    recordInstallVersion(workspace.rootDirectory);
  };

  const existingWorkspace = findWorkspace(rootDirectory);
  if (existingWorkspace !== null && existingWorkspace.rootDirectory !== workspace.rootDirectory) {
    throw new OperationRefusal(
      'refused',
      `A tracker already governs this directory: ${existingWorkspace.trackerDirectory}. `
      + `Run \`agent-progress update\` in ${existingWorkspace.rootDirectory} instead to refresh what the tracker writes into the repository.`,
    );
  }

  // Every installed text is computed before the first write, so a dispatcher that will not bundle leaves no tracker and no file behind.
  const installedFileTexts = await installedFileTextsFor({ generatesTheDispatcherScript: writesTheDispatcherWorkflow });
  if (existingWorkspace !== null) {
    await reportTheRefreshOfAnExistingTracker(installedFileTexts);
    return;
  }

  const ignoreOutcome = ensureIgnored(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME);
  const project  = commandArguments.option('project') ?? basename(rootDirectory);
  const creation = await createTracker(workspace, {
    project,
    startedAt: TimeUtil.formatLocalIso(context.now()),
    // The page's localStorage key: `file://` is one origin in Chrome, so two trackers would otherwise share a saved range.
    trackerId: randomUUID(),
  }, context.now, context.renderState);
  if (creation.verdict === 'already-exists') {
    await reportTheRefreshOfAnExistingTracker(installedFileTexts);
    return;
  }
  OutputUtil.reportRenderProblems(context, creation.renderOutcome);

  const refresh = refreshTheRepository(installedFileTexts);

  context.standardOutput(`Initialised agent-progress for "${project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  brief:       ${refresh.briefFilePath}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome] ?? ignoreOutcome}`);
  context.standardOutput(`  CLAUDE.md:   ${refresh.claudeInstructionsLine}`);
  context.standardOutput(`  hooks:       ${refresh.hookLine}`);
  context.standardOutput(`  workflow:    ${refresh.workflowLine}`);
  context.standardOutput(`  agent:       ${refresh.agentDefinitionLine}`);
  recordInstallVersion(workspace.rootDirectory);
};
