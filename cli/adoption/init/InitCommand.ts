import { randomUUID } from 'node:crypto';
import { basename }   from 'node:path';

import { ensureIgnored, type EnsureIgnoredOutcome }                             from '../../../src/lib/git/GitIgnore.ts';
import { TimeUtil }                                                             from '../../../src/lib/utils/TimeUtil.ts';
import { createTracker }                                                        from '../../../src/services/tracker/TrackerCreation.ts';
import { findWorkspace, workspacePathsFor }                                     from '../../../src/services/tracker/Workspace.ts';
import { TRACKER_FILES }                                                        from '../../../src/services/tracker/constants/TrackerFiles.ts';
import { OperationRefusal }                                                     from '../../../src/shared/OperationRefusal.ts';
import type { CommandHandler }                                                  from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace }                          from '../../InstallVersionCheck.ts';
import { OlderTrackerFilesRewriteReport }                                       from '../../legacy/OlderTrackerFilesRewriteReport.ts';
import { IGNORED_RETIRED_OPTION_NAMES }                                         from '../../legacy/constants/IgnoredRetiredOptions.ts';
import { OutputUtil }                                                           from '../../utils/OutputUtil.ts';
import { installedFileTextsFor }                                                from '../InstalledFileGeneration.ts';
import type { InstalledFileTexts }                                              from '../InstalledFileGeneration.ts';
import { recordInstallVersion, refreshReportLinesOf, refreshTrackedRepository } from '../TrackerRefresh.ts';
import { initRootDirectoryOf, refuseAnOverrideNamingAnotherDirectory }          from './InitRoot.ts';

const USAGE = 'agent-progress init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

// The seam to the retired `--hooks`; dropping `cli/legacy/` drops the spread.
const KNOWN_OPTION_NAMES = ['project', 'root', 'no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition', ...IGNORED_RETIRED_OPTION_NAMES];

const IGNORE_OUTCOME_WORDS: Record<EnsureIgnoredOutcome, string> = {
  'already-ignored':      'already ignored, so nothing was added',
  'appended':             'entry added',
  'no-gitignore-written': 'not written — this directory is not a git repository',
};

export const initCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const rootDirectory = initRootDirectoryOf(commandArguments.option('root'), context.currentDirectory);
  const workspace     = workspacePathsFor(rootDirectory);
  const writesClaudeInstructions = !commandArguments.flag('no-claude-md');
  const writesTheSubagentStopHook = !commandArguments.flag('no-hooks');
  const writesTheDispatcherWorkflow = !commandArguments.flag('no-workflow');
  const writesTheAgentDefinition = !commandArguments.flag('no-agent-definition');

  refuseAnOverrideNamingAnotherDirectory(context.currentDirectory, rootDirectory);

  // The brief, the block and the hook are written by the same refresh a second `init` and `update` run, so a fresh tracker and an adopted one never drift.
  const refreshTheRepository = (installedFileTexts: InstalledFileTexts, { writesTheBriefFirst }: { writesTheBriefFirst: boolean }) => refreshTrackedRepository({
    workspace,
    installedFileTexts,
    commandName:   'init',
    writesClaudeInstructions,
    writesTheSubagentStopHook,
    writesTheAgentDefinition,
    writesTheBriefFirst,
    standardError: context.standardError,
  });
  const reportTheRefreshOfAnExistingTracker = async (installedFileTexts: InstalledFileTexts) => {
    const refresh = refreshTheRepository(installedFileTexts, { writesTheBriefFirst: false });
    const printRefreshReport = (trackerLine: string | null) => {
      context.standardOutput(`agent-progress is already initialised in ${rootDirectory}.`);
      if (trackerLine !== null) context.standardOutput(`  tracker:     ${trackerLine}`);
      for (const line of refreshReportLinesOf(refresh, workspace.htmlFilePath)) context.standardOutput(line);
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
  requireInstallManifestThisVersionCanReplace(workspace.rootDirectory);

  // Every installed text is computed before the first write, so a dispatcher that will not bundle leaves no tracker and no file behind.
  const installedFileTexts = await installedFileTextsFor({ generatesTheDispatcherScript: writesTheDispatcherWorkflow });
  if (existingWorkspace !== null) {
    await reportTheRefreshOfAnExistingTracker(installedFileTexts);
    return;
  }

  // The ignore entry goes in before the tracker directory exists, so the tracker is never briefly visible to git status.
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

  const refresh = refreshTheRepository(installedFileTexts, { writesTheBriefFirst: true });

  context.standardOutput(`Initialised agent-progress for "${project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  brief:       ${refresh.briefFilePath}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome]}`);
  context.standardOutput(`  CLAUDE.md:   ${refresh.claudeInstructionsLine}`);
  context.standardOutput(`  hooks:       ${refresh.hookLine}`);
  context.standardOutput(`  workflow:    ${refresh.workflowLine}`);
  context.standardOutput(`  agent:       ${refresh.agentDefinitionLine}`);
  recordInstallVersion(workspace.rootDirectory);
};
