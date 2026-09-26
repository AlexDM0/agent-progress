/**
 * `update`: refresh what the tool wrote into a repository it already tracks, so nobody reaches for
 * `init` — a verb that reads as destructive — to pick up a newer brief or CLAUDE.md block. It creates
 * no tracker, so it takes neither `--project` nor `--root`, and touches the tracker only to rewrite
 * files still in an older format.
 */
import { requireWorkspace }                                                    from '../../lib/platform/Workspace';
import { rewriteOlderTrackerFiles, rewrittenFilesTextOf, type TrackerRewrite } from '../CommandSupport';
import type { CommandHandler }                                                 from '../CommandTable';
import { refreshTrackedRepository }                                            from '../TrackerRefresh';

const USAGE = 'agent-progress update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]';

// `--hooks` is kept, and does nothing: the hook it used to ask for is now written by default, and a habit that still types it should not be refused.
const KNOWN_OPTION_NAMES = ['no-claude-md', 'hooks', 'no-hooks', 'no-workflow', 'no-agent-definition'];

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

  let rewrite: TrackerRewrite | null;
  try {
    rewrite = await rewriteOlderTrackerFiles(context, workspace);
  } catch (error) {
    // The repository files are already refreshed, and a session must still learn its brief is stale; the refusal then exits 2.
    printRefreshReport(`Refreshed what agent-progress manages in ${workspace.rootDirectory}; its older tracker files were not rewritten.`);
    throw error;
  }
  printRefreshReport(rewrite === null
    ? `Refreshed what agent-progress manages in ${workspace.rootDirectory}; the tracker itself was not touched.`
    : `Refreshed what agent-progress manages in ${workspace.rootDirectory}, and rewrote its older tracker files in the current format: ${rewrittenFilesTextOf(rewrite)}.`);
};
