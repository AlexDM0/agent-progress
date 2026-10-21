import { randomUUID } from 'node:crypto';
import { basename }   from 'node:path';

import { ensureIgnored, type EnsureIgnoredOutcome }          from '../../../src/lib/git/GitIgnore.ts';
import { LocalTimeUtil }                                     from '../../../src/lib/local-time/LocalTimeUtil.ts';
import { createTracker }                                     from '../../../src/services/tracker/TrackerCreation.ts';
import { findWorkspace, workspacePathsFor }                  from '../../../src/services/tracker/Workspace.ts';
import { TRACKER_FILES }                                     from '../../../src/services/tracker/constants/TrackerFiles.ts';
import { OperationRefusal }                                  from '../../../src/shared/OperationRefusal.ts';
import { AGENT_HOSTS, DEFAULT_AGENT_HOST, type AgentHost }   from '../../../src/shared/constants/AgentHosts.ts';
import type { CommandHandler }                               from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace }       from '../../InstallVersionCheck.ts';
import { registerWrittenDashboard }                          from '../../RegisterWrittenDashboard.ts';
import { OutputUtil }                                        from '../../utils/OutputUtil.ts';
import { refuseAnotherAgentHostsLeftovers }                  from '../AgentHostLeftovers.ts';
import { installedFileTextsFor, installedSkillFileTextsFor } from '../InstalledFileGeneration.ts';
import type { InstalledFileTexts }                           from '../InstalledFileGeneration.ts';
import {
  optOutFlagsGiven,
  recordInstallVersion,
  refreshReportLinesOf,
  reportLineOf,
  refreshTrackedRepository,
  refuseAnAgentDefinitionOptOutKeepingTheWorkflow,
  refuseKeepingADispatcherWithoutItsAgentDefinition
}                                                                             from '../TrackerRefresh.ts';
import { requireCopilotCliVersion }                                    from './CopilotVersionCheck.ts';
import { initRootDirectoryOf, refuseAnOverrideNamingAnotherDirectory } from './InitRoot.ts';

const USAGE = 'agent-progress init [--project <name>] [--root <path>] [--host claude-code|copilot-cli] [--no-claude-md] [--no-hooks] [--no-workflow] '
  + '[--no-agent-definition]';

const KNOWN_OPTION_NAMES = ['project', 'root', 'host', 'no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition'];

const COPILOT_TRUST_LINE = '  Copilot CLI loads the extension only in a folder it trusts: start `copilot` here once and trust this folder, '
  + 'or the agent-progress-dispatch workflow is reported as not found.';

function agentHostOf(hostOption: string | undefined): AgentHost {
  if (hostOption === undefined) return DEFAULT_AGENT_HOST;
  const agentHost = AGENT_HOSTS.find((host) => host === hostOption);
  if (agentHost === undefined) throw new OperationRefusal('refused', `--host takes ${AGENT_HOSTS.join(' or ')}, not "${hostOption}".\nUsage: ${USAGE}`);
  return agentHost;
}

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
  const optOutFlags = optOutFlagsGiven((flagName) => commandArguments.flag(flagName));
  const writesTheDispatcherWorkflow = !optOutFlags.has('no-workflow');
  const writesTheAgentDefinition = !optOutFlags.has('no-agent-definition');
  refuseAnAgentDefinitionOptOutKeepingTheWorkflow('init', { writesTheAgentDefinition, writesTheDispatcherWorkflow });

  refuseAnOverrideNamingAnotherDirectory(context.currentDirectory, rootDirectory);
  const agentHost = agentHostOf(commandArguments.option('host'));
  if (agentHost === 'copilot-cli') requireCopilotCliVersion(context.copilotVersionOutput());
  const reportTheTrustCopilotNeeds = () => {
    if (agentHost === 'copilot-cli' && writesTheDispatcherWorkflow) context.standardOutput(COPILOT_TRUST_LINE);
  };

  const installedSkillFileTexts = installedSkillFileTextsFor(agentHost);
  // The brief, the block and the hook are written by the same refresh a second `init` and `update` run, so a fresh tracker and an adopted one never drift.
  const refreshTheRepository = (installedFileTexts: InstalledFileTexts, { writesTheBriefFirst }: { writesTheBriefFirst: boolean }) => refreshTrackedRepository({
    workspace,
    agentHost,
    installedFileTexts,
    installedSkillFileTexts,
    commandName:   'init',
    optOutFlags,
    writesTheBriefFirst,
    standardError: context.standardError,
  });
  const reportTheRefreshOfAnExistingTracker = (installedFileTexts: InstalledFileTexts) => {
    const refresh = refreshTheRepository(installedFileTexts, { writesTheBriefFirst: false });
    context.standardOutput(`agent-progress is already initialised in ${rootDirectory}.`);
    for (const line of refreshReportLinesOf(refresh, workspace.htmlFilePath)) context.standardOutput(line);
    context.standardOutput('  `agent-progress update` is the command for this refresh; `init` only creates a tracker.');
    reportTheTrustCopilotNeeds();
    recordInstallVersion(workspace.rootDirectory, agentHost);
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
  refuseKeepingADispatcherWithoutItsAgentDefinition('init', { rootDirectory: workspace.rootDirectory, agentHost }, { writesTheAgentDefinition, writesTheDispatcherWorkflow });
  refuseAnotherAgentHostsLeftovers('init', { rootDirectory: workspace.rootDirectory, agentHost });

  // Every installed text is computed before the first write, so a dispatcher that will not bundle leaves no tracker and no file behind.
  const installedFileTexts = await installedFileTextsFor({ agentHost, generatesTheDispatcherScript: writesTheDispatcherWorkflow });
  if (existingWorkspace !== null) {
    reportTheRefreshOfAnExistingTracker(installedFileTexts);
    return;
  }

  // The ignore entry goes in before the tracker directory exists, so the tracker is never briefly visible to git status.
  const ignoreOutcome = ensureIgnored(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME);
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

  context.standardOutput(`Initialised agent-progress for "${project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  brief:       ${refresh.briefFilePath}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome]}`);
  for (const { reportLabel, line, marksTheInstall } of refresh.partLines) {
    if (!marksTheInstall) context.standardOutput(reportLineOf(reportLabel, line));
  }
  reportTheTrustCopilotNeeds();
  recordInstallVersion(workspace.rootDirectory, agentHost);
};
