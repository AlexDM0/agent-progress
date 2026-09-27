/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up a newer brief or CLAUDE.md block. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and touches the tracker only to rewrite
 * files still in an older format.
 */
import { requireWorkspace }                                                     from '../../../src/services/tracker/Workspace.ts';
import type { CommandHandler }                                                  from '../../CommandTable.ts';
import { requireNoNewerInstall }                                                from '../../InstallVersionCheck.ts';
import { OlderTrackerFilesRewriteReport }                                       from '../../legacy/OlderTrackerFilesRewriteReport.ts';
import { IGNORED_RETIRED_OPTION_NAMES }                                         from '../../legacy/constants/IgnoredRetiredOptions.ts';
import { installedFileTextsFor }                                                from '../InstalledFileGeneration.ts';
import { recordInstallVersion, refreshReportLinesOf, refreshTrackedRepository } from '../TrackerRefresh.ts';

const USAGE = 'agent-progress update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

// The seam to the retired `--hooks`; dropping `cli/legacy/` drops the spread.
const KNOWN_OPTION_NAMES = ['no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition', ...IGNORED_RETIRED_OPTION_NAMES];

export const updateCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace          = requireWorkspace(context.currentDirectory);
  requireNoNewerInstall(workspace.rootDirectory);
  const installedFileTexts = await installedFileTextsFor({ generatesTheDispatcherScript: !commandArguments.flag('no-workflow') });
  const report             = refreshTrackedRepository({
    workspace,
    installedFileTexts,
    commandName:               'update',
    writesClaudeInstructions:  !commandArguments.flag('no-claude-md'),
    writesTheSubagentStopHook: !commandArguments.flag('no-hooks'),
    writesTheAgentDefinition:  !commandArguments.flag('no-agent-definition'),
    standardError:             context.standardError,
  });

  const printRefreshReport = (headingLine: string) => {
    context.standardOutput(headingLine);
    for (const line of refreshReportLinesOf(report, workspace.htmlFilePath)) context.standardOutput(line);
  };

  // Dropping cli/legacy/ makes this one call: printRefreshReport(`Refreshed what agent-progress manages in ${workspace.rootDirectory}; the tracker
  // itself was not touched.`).
  await OlderTrackerFilesRewriteReport.rewriteThenPrintUpdateHeading(context, workspace, printRefreshReport);
  recordInstallVersion(workspace.rootDirectory);
};
