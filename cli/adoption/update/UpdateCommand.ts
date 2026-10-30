/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up newer instructions. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and never touches the tracker's own files.
 */
import { Baton }                                          from '../../../src/services/overseer/Baton.ts';
import { CodeVersion }                                    from '../../../src/services/overseer/CodeVersion.ts';
import { overseerFilesIn }                                from '../../../src/services/overseer/OverseerFiles.ts';
import { requireWorkspace }                               from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                                  from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                            from '../../CommandContext.ts';
import type { CommandHandler }                            from '../../CommandHandler.ts';
import { requireInstallManifestThisVersionCanReplace }    from '../../InstallVersionCheck.ts';
import { writeProgressPageStub }                          from '../../WriteProgressPageStub.ts';
import { INSTALL_VERSION }                                from '../../constants/InstallVersion.ts';
import { OverseerRemote }                                 from '../../overseer/OverseerRemote.ts';
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
  writeProgressPageStub(workspace);
  recordInstallVersion(workspace.rootDirectory);
  await handTheLiveOverseerToTheCodeOnDisk(context, workspace.trackerDirectory);
};

/**
 * The last step of `update`: a live Overseer on other code or another install version is handed to the code on disk through the checked
 * Baton pass. A failed one exits 1 `baton-pass-failed` with the old Overseer still driving, and what `update` installed stands.
 */
async function handTheLiveOverseerToTheCodeOnDisk(context: CommandContext, trackerDirectory: string): Promise<void> {
  const files  = overseerFilesIn(trackerDirectory);
  const newest = Baton.newestBatonOf(files.overseerDirectory);
  if (newest.verdict !== 'live') return;
  if (newest.record.codeVersion === CodeVersion.onDisk() && newest.record.installVersion === INSTALL_VERSION) return;
  context.standardOutput(`Handing the Overseer at ${newest.record.url} over to the code on disk…`);
  const batonPass = await OverseerRemote.handOverTheLiveOverseer(files, false);
  if (batonPass.verdict === 'handed-over') {
    context.standardOutput(`Overseer handed over to code ${batonPass.successorCodeVersion} at ${batonPass.url}.`);
    return;
  }
  if (batonPass.verdict === 'not-taken') {
    context.standardOutput(`The Overseer at ${batonPass.record.url} did not take the Baton pass; run \`${PRODUCT_NAMES.PROGRAM} oversee restart\`.`);
  }
}
