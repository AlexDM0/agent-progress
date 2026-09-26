/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up a newer brief or CLAUDE.md block. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and touches the tracker only to rewrite
 * files still in an older format.
 */
import { requireWorkspace }               from '../../../src/services/tracker/Workspace';
import type { CommandHandler }            from '../../CommandTable';
import { OlderTrackerFilesRewriteReport } from '../../legacy/OlderTrackerFilesRewriteReport';
import { IGNORED_RETIRED_OPTION_NAMES }   from '../../legacy/constants/IgnoredRetiredOptions';
import { refreshTrackedRepository }       from '../TrackerRefresh';

const USAGE = 'agent-progress update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

const KNOWN_OPTION_NAMES = ['no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition', ...IGNORED_RETIRED_OPTION_NAMES];

export const updateCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  const report    = refreshTrackedRepository({
    workspace,
    commandName:                 'update',
    writesClaudeInstructions:    !commandArguments.flag('no-claude-md'),
    writesTheSubagentStopHook:   !commandArguments.flag('no-hooks'),
    writesTheDispatcherWorkflow: !commandArguments.flag('no-workflow'),
    writesTheAgentDefinition:    !commandArguments.flag('no-agent-definition'),
    standardError:               context.standardError,
  });

  const printRefreshReport = (headingLine: string) => {
    context.standardOutput(headingLine);
    context.standardOutput(`  CLAUDE.md:   ${report.claudeInstructionsLine}`);
    context.standardOutput(`  brief:       ${report.briefLine}`);
    context.standardOutput(`  hooks:       ${report.hookLine}`);
    context.standardOutput(`  workflow:    ${report.workflowLine}`);
    context.standardOutput(`  agent:       ${report.agentDefinitionLine}`);
    context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  };

  // Dropping cli/legacy/ makes this one call: printRefreshReport(`Refreshed what agent-progress manages in ${workspace.rootDirectory}; the tracker
  // itself was not touched.`).
  await OlderTrackerFilesRewriteReport.rewriteThenPrintUpdateHeading(context, workspace, printRefreshReport);
};
