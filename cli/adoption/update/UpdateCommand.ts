/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up newer instructions. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and never touches the tracker's own files.
 */
import { CodeVersion }                                    from '../../../src/services/runner/CodeVersion.ts';
import { runnerFilesIn }                                  from '../../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                                    from '../../../src/services/runner/RunnerLease.ts';
import { requireWorkspace }                               from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                                  from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                            from '../../CommandContext.ts';
import type { CommandHandler }                            from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace }    from '../../InstallVersionCheck.ts';
import { INSTALL_VERSION }                                from '../../constants/InstallVersion.ts';
import { RunnerRemote }                                   from '../../runner/RunnerRemote.ts';
import { installedFileTextsFor, installedSkillFileTexts } from '../InstalledFileGeneration.ts';
import { refuseBesideAnOlderProgram }                     from '../OlderProgramRefusal.ts';
import { refuseARetiredAgentHostsInstall }                from '../RetiredAgentHostRefusal.ts';
import {
  optOutFlagsGiven,
  recordInstallVersion,
  refreshReportLinesOf,
  refreshTrackedRepository
}                                                                             from '../TrackerRefresh.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} update [--no-hooks]`;

const KNOWN_OPTION_NAMES = ['no-hooks'];

export const updateCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const optOutFlags = optOutFlagsGiven((flagName) => commandArguments.flag(flagName));

  const workspace          = requireWorkspace(context.currentDirectory);
  refuseBesideAnOlderProgram(workspace.rootDirectory);
  requireInstallManifestThisVersionCanReplace(workspace.rootDirectory);
  refuseARetiredAgentHostsInstall('update', workspace.rootDirectory);
  const installedFileTexts = installedFileTextsFor();
  const report             = refreshTrackedRepository({
    workspace,
    installedFileTexts,
    installedSkillFileTexts: installedSkillFileTexts(),
    commandName:             'update',
    optOutFlags,
    writesTheBriefFirst:     false,
    standardError:           context.standardError,
  });

  context.standardOutput(`Refreshed what ${PRODUCT_NAMES.PROGRAM} manages in ${workspace.rootDirectory}; the tracker itself was not touched.`);
  for (const line of refreshReportLinesOf(report, workspace.htmlFilePath)) context.standardOutput(line);
  recordInstallVersion(workspace.rootDirectory);
  await handTheLiveRunnerToTheCodeOnDisk(context, workspace.trackerDirectory);
};

/**
 * The last step of `update`: a live runner on other code or another install version is handed to the code on disk through the checked
 * handover. A failed one exits 1 `runner-handover-failed` with the old runner still driving, and what `update` installed stands.
 */
async function handTheLiveRunnerToTheCodeOnDisk(context: CommandContext, trackerDirectory: string): Promise<void> {
  const files  = runnerFilesIn(trackerDirectory);
  const newest = RunnerLease.newestLeaseOf(files.runnerDirectory);
  if (newest.verdict !== 'live') return;
  if (newest.record.codeVersion === CodeVersion.onDisk() && newest.record.installVersion === INSTALL_VERSION) return;
  context.standardOutput(`Handing the runner at ${newest.record.url} over to the code on disk…`);
  const handover = await RunnerRemote.handOverTheLiveRunner(files, false);
  if (handover.verdict === 'handed-over') {
    context.standardOutput(`Runner handed over to code ${handover.successorCodeVersion} at ${handover.url}.`);
    return;
  }
  if (handover.verdict === 'not-taken') {
    context.standardOutput(`The runner at ${handover.record.url} did not take the handover; run \`${PRODUCT_NAMES.PROGRAM} run restart\`.`);
  }
}
