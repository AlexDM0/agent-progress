import { randomUUID } from 'node:crypto';
import { basename }   from 'node:path';

import { ensureIgnored }                                  from '../../../src/lib/git/GitIgnore.ts';
import { LocalTimeUtil }                                  from '../../../src/lib/local-time/LocalTimeUtil.ts';
import { createTracker }                                  from '../../../src/services/tracker/TrackerCreation.ts';
import { findWorkspace, workspacePathsFor }               from '../../../src/services/tracker/Workspace.ts';
import { TRACKER_FILES }                                  from '../../../src/services/tracker/constants/TrackerFiles.ts';
import { OperationRefusal }                               from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                  from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }                            from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace }    from '../../InstallVersionCheck.ts';
import { registerWrittenDashboard }                       from '../../RegisterWrittenDashboard.ts';
import { OutputUtil }                                     from '../../utils/OutputUtil.ts';
import { installedFileTextsFor, installedSkillFileTexts } from '../InstalledFileGeneration.ts';
import type { InstalledFileTexts }                        from '../InstalledFileGeneration.ts';
import { refuseBesideAnOlderProgram }                     from '../OlderProgramRefusal.ts';
import { refuseARetiredAgentHostsInstall }                from '../RetiredAgentHostRefusal.ts';
import {
  IGNORE_OUTCOME_WORDS,
  optOutFlagsGiven,
  recordInstallVersion,
  refreshReportLinesOf,
  reportLineOf,
  refreshTrackedRepository
}                                                                             from '../TrackerRefresh.ts';
import { initRootDirectoryOf, refuseAnOverrideNamingAnotherDirectory } from './InitRoot.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} init [--project <name>] [--root <path>] [--no-hooks]`;

const KNOWN_OPTION_NAMES = ['project', 'root', 'no-hooks'];

export const initCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const rootDirectory = initRootDirectoryOf(commandArguments.option('root'), context.currentDirectory);
  const workspace     = workspacePathsFor(rootDirectory);
  const optOutFlags = optOutFlagsGiven((flagName) => commandArguments.flag(flagName));

  refuseAnOverrideNamingAnotherDirectory(context.currentDirectory, rootDirectory);

  const skillFileTexts = installedSkillFileTexts();
  // The briefs, the hook and the skills are written by the same refresh a second `init` and `update` run, so a fresh tracker and an
  // adopted one never drift.
  const refreshTheRepository = (installedFileTexts: InstalledFileTexts, { writesTheBriefFirst }: { writesTheBriefFirst: boolean }) => refreshTrackedRepository({
    workspace,
    installedFileTexts,
    installedSkillFileTexts: skillFileTexts,
    commandName:             'init',
    optOutFlags,
    writesTheBriefFirst,
    standardError:           context.standardError,
  });
  const reportTheRefreshOfAnExistingTracker = (installedFileTexts: InstalledFileTexts) => {
    const refresh = refreshTheRepository(installedFileTexts, { writesTheBriefFirst: false });
    context.standardOutput(`${PRODUCT_NAMES.PROGRAM} is already initialised in ${rootDirectory}.`);
    for (const line of refreshReportLinesOf(refresh, workspace.htmlFilePath)) context.standardOutput(line);
    context.standardOutput(`  \`${PRODUCT_NAMES.PROGRAM} update\` is the command for this refresh; \`init\` only creates a tracker.`);
    recordInstallVersion(workspace.rootDirectory);
  };

  const existingWorkspace = findWorkspace(rootDirectory);
  if (existingWorkspace !== null && existingWorkspace.rootDirectory !== workspace.rootDirectory) {
    throw new OperationRefusal(
      'refused',
      `A tracker already governs this directory: ${existingWorkspace.trackerDirectory}. `
      + `Run \`${PRODUCT_NAMES.PROGRAM} update\` in ${existingWorkspace.rootDirectory} instead to refresh what the tracker writes into the repository.`,
    );
  }
  refuseBesideAnOlderProgram(workspace.rootDirectory);
  requireInstallManifestThisVersionCanReplace(workspace.rootDirectory);
  refuseARetiredAgentHostsInstall('init', workspace.rootDirectory);

  // Every installed text is computed before the first write, so a template that will not read leaves no tracker and no file behind.
  const installedFileTexts = installedFileTextsFor();
  if (existingWorkspace !== null) {
    reportTheRefreshOfAnExistingTracker(installedFileTexts);
    return;
  }

  // The ignore entries go in before the tracker directory exists, so the tracker is never briefly visible to git status, and before any
  // worktree can exist.
  const ignoreOutcome = ensureIgnored(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME);
  ensureIgnored(rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER);
  const project  = commandArguments.option('project') ?? basename(rootDirectory);
  const creation = await createTracker(workspace, {
    project,
    startedAt: LocalTimeUtil.formatLocalIso(context.now()),
    // The page's localStorage key: `file://` is one origin in Chrome, so two trackers would otherwise share a saved range.
    trackerId: randomUUID(),
  }, context.now, context.renderState);
  if (creation.verdict === 'already-exists') {
    reportTheRefreshOfAnExistingTracker(installedFileTexts);
    return;
  }
  OutputUtil.reportRenderProblems(context, creation.renderOutcome);
  await registerWrittenDashboard(context, workspace, creation.renderOutcome);

  const refresh = refreshTheRepository(installedFileTexts, { writesTheBriefFirst: true });

  context.standardOutput(`Initialised ${PRODUCT_NAMES.PROGRAM} for "${project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  brief:       ${refresh.briefFilePath}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome]}`);
  for (const { reportLabel, line, marksTheInstall } of refresh.partLines) {
    if (!marksTheInstall) context.standardOutput(reportLineOf(reportLabel, line));
  }
  recordInstallVersion(workspace.rootDirectory);
};
